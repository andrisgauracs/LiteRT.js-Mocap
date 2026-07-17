// ---------------------------------------------------------------------------
// App orchestration:
//   webcam → PoseDetector (LiteRT.js) → landmark smoothing → Retargeter →
//   Three.js character, with overlay / HUD / recorder alongside.
//
// Two loops run concurrently:
//   - INFERENCE loop: as fast as the model allows (awaits each result, so
//     nothing queues up if inference is slower than the display).
//   - RENDER loop: every display frame. Reads the latest landmarks, steps the
//     retargeter (whose slerp smoothing interpolates between inference
//     results), draws the overlay, HUD and 3D scene.
// ---------------------------------------------------------------------------

import { PoseDetector } from './pose/detector.js';
import { LandmarkSmoother } from './pose/smoothing.js';
import { mirrorLandmarks, extendLandmarks, NUM_LANDMARKS } from './pose/landmarks.js';
import { Retargeter } from './retarget/retarget.js';
import { CHARACTERS, DEFAULT_CHARACTER } from './retarget/characters.js';
import { Stage } from './scene.js';
import { startWebcam, WebcamError } from './camera.js';
import { Overlay } from './overlay.js';
import { Hud } from './hud.js';
import { SessionRecorder } from './exporter.js';
import { setStatus, hideStatus, showError, toast } from './ui.js';

const els = {
  video: document.getElementById('video'),
  overlay: document.getElementById('overlay'),
  sceneWrap: document.getElementById('scene-wrap'),
  backendSelect: document.getElementById('backend-select'),
  characterSelect: document.getElementById('character-select'),
  mirrorToggle: document.getElementById('mirror-toggle'),
  recordBtn: document.getElementById('record-btn'),
  exportJsonBtn: document.getElementById('export-json-btn'),
  exportBvhBtn: document.getElementById('export-bvh-btn'),
  recBadge: document.getElementById('rec-badge'),
  recFrames: document.getElementById('rec-frames'),
};

const state = {
  detector: null,
  stage: null,
  retargeter: null,
  characterKey: DEFAULT_CHARACTER,
  mirror: true,
  latest: null,          // { screen, worldExtended, score, receivedAt }
  lastRenderTime: 0,
  busy: false,           // guards backend/character switches
};

const hud = new Hud();
const recorder = new SessionRecorder();
// Debug handle (also handy on camera: poke the pipeline from DevTools).
window.__mocap = state;
window.__mocap.recorder = recorder;
// Separate smoothers for the 2D overlay points and the 3D world points.
const screenSmoother = new LandmarkSmoother(NUM_LANDMARKS, { minCutoff: 1.5, beta: 0.06 });
const worldSmoother = new LandmarkSmoother(NUM_LANDMARKS, { minCutoff: 1.0, beta: 0.05 });

boot().catch((err) => {
  console.error(err);
  showError('Something went wrong', err.message || String(err));
});

async function boot() {
  applyMirrorClass();

  // 1. Webcam first — the permission prompt should be the first thing seen.
  setStatus('Requesting camera…', 'Allow camera access to start tracking.');
  try {
    await startWebcam(els.video);
  } catch (err) {
    if (err instanceof WebcamError) {
      showError('Camera unavailable', err.message);
      return;
    }
    throw err;
  }

  // 2. Boot the LiteRT runtime + pick the best available backend.
  setStatus('Loading LiteRT.js runtime…', 'Initializing Wasm modules');
  state.detector = new PoseDetector();
  await state.detector.init();

  let backend = 'webgpu';
  if (!PoseDetector.webGpuAvailable()) {
    backend = 'wasm';
    els.backendSelect.querySelector('option[value="webgpu"]').disabled = true;
    toast('WebGPU is not available in this browser — running on CPU (XNNPACK/Wasm).', 6000);
  }

  // 3. Compile the pose model and load the character in parallel.
  state.stage = new Stage(els.sceneWrap);
  const compilePromise = compileBackend(backend, true);
  const characterPromise = loadCharacter(state.characterKey);
  await Promise.all([compilePromise, characterPromise]);

  // 4. Wire up the controls and start both loops.
  setupControls();
  hideStatus();
  startInferenceLoop();
  startRenderLoop();
}

// --------------------------------------------------------------------------
// Model / character loading
// --------------------------------------------------------------------------

async function compileBackend(backend, firstLoad = false) {
  const label = backend === 'webgpu' ? 'WebGPU' : 'CPU (Wasm)';
  try {
    await state.detector.compile(backend, (f, msg) => {
      if (firstLoad) setStatus('Preparing pose model…', msg, f);
    });
  } catch (err) {
    console.error(`Compile for ${backend} failed:`, err);
    if (backend === 'webgpu') {
      toast('WebGPU compile failed — falling back to CPU (Wasm).', 6000);
      els.backendSelect.querySelector('option[value="webgpu"]').disabled = true;
      return compileBackend('wasm', firstLoad);
    }
    throw new Error(`Could not compile the pose model: ${err.message}`);
  }
  els.backendSelect.value = state.detector.backend;
  hud.setBackend(state.detector.backend === 'webgpu' ? 'WebGPU' : 'CPU·Wasm');
}

async function loadCharacter(key) {
  const config = CHARACTERS[key];
  const root = await state.stage.loadCharacter(config);
  state.retargeter = new Retargeter(root, config);
  state.characterKey = key;
}

// --------------------------------------------------------------------------
// Loops
// --------------------------------------------------------------------------

function startInferenceLoop() {
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  (async () => {
    let lastT = performance.now();
    while (true) {
      await nextFrame();
      if (state.busy || !state.detector.model) continue;
      try {
        const result = await state.detector.detect(els.video);
        const now = performance.now();
        const dt = Math.min((now - lastT) / 1000, 0.25);
        lastT = now;
        hud.tickInference(state.detector.lastInferMs);

        if (!result) {
          if (state.latest && now - state.latest.receivedAt > 600) state.latest = null;
          continue;
        }

        // Smooth in the raw (unmirrored) space so the filters see a
        // continuous signal even when the mirror toggle flips.
        const screen = screenSmoother.apply(result.screen, dt);
        let world = worldSmoother.apply(result.world, dt);
        if (state.mirror) world = mirrorLandmarks(world, 0);

        state.latest = {
          screen,
          worldExtended: extendLandmarks(world),
          score: result.score,
          receivedAt: now,
        };
      } catch (err) {
        console.error('Inference error:', err);
        toast(`Inference error: ${err.message}`, 5000);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  })();
}

function startRenderLoop() {
  const overlay = new Overlay(els.overlay, els.video);
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min((now - (state.lastRenderTime || now)) / 1000, 0.1) || 1 / 60;
    state.lastRenderTime = now;
    hud.tickFrame(dt);

    const fresh = state.latest && now - state.latest.receivedAt < 500;
    if (state.retargeter) {
      if (fresh) state.retargeter.update(state.latest.worldExtended, dt);
      else state.retargeter.relax(dt); // tracking lost → ease back to rest pose
      hud.setTracking(fresh ? state.retargeter.trackingMode : '–');
    }
    overlay.draw(fresh ? state.latest.screen : null);

    if (recorder.recording && fresh) {
      recorder.capture(state.latest.worldExtended, state.latest.score);
      els.recFrames.textContent = recorder.frameCount;
    }

    state.stage.render();
    hud.draw(now);
  };
  requestAnimationFrame(loop);
}

// --------------------------------------------------------------------------
// Controls
// --------------------------------------------------------------------------

function setupControls() {
  // Backend switcher — the live WebGPU vs CPU comparison.
  els.backendSelect.disabled = false;
  els.backendSelect.value = state.detector.backend;
  els.backendSelect.addEventListener('change', async () => {
    const target = els.backendSelect.value;
    if (target === state.detector.backend || state.busy) return;
    state.busy = true;
    els.backendSelect.disabled = true;
    toast(`Compiling model for ${target === 'webgpu' ? 'WebGPU' : 'CPU (Wasm)'}…`, 10000);
    try {
      await compileBackend(target);
      toast(`Running on ${target === 'webgpu' ? 'WebGPU' : 'CPU (XNNPACK/Wasm)'}`);
    } finally {
      state.busy = false;
      els.backendSelect.disabled = false;
    }
  });

  // Character switcher — proves the retargeting layer is rig-agnostic.
  for (const [key, cfg] of Object.entries(CHARACTERS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = cfg.label;
    els.characterSelect.appendChild(opt);
  }
  els.characterSelect.value = state.characterKey;
  els.characterSelect.disabled = false;
  els.characterSelect.addEventListener('change', async () => {
    const key = els.characterSelect.value;
    if (key === state.characterKey || state.busy) return;
    state.busy = true;
    els.characterSelect.disabled = true;
    if (recorder.recording) stopRecording();
    try {
      await loadCharacter(key);
    } catch (err) {
      console.error(err);
      toast(`Could not load character: ${err.message}`, 5000);
      els.characterSelect.value = state.characterKey;
    } finally {
      state.busy = false;
      els.characterSelect.disabled = false;
    }
  });

  els.mirrorToggle.addEventListener('change', () => {
    state.mirror = els.mirrorToggle.checked;
    applyMirrorClass();
    // Mirrored landmarks flip sides — position-driven bones must recalibrate.
    state.retargeter?.resetCalibration();
  });

  els.recordBtn.disabled = false;
  els.recordBtn.addEventListener('click', () => {
    if (recorder.recording) stopRecording();
    else startRecording();
  });
  els.exportJsonBtn.addEventListener('click', () => recorder.exportJSON());
  els.exportBvhBtn.addEventListener('click', () => recorder.exportBVH());
}

function startRecording() {
  recorder.start(state.stage.character, state.characterKey);
  els.recordBtn.textContent = '■ Stop';
  els.recordBtn.classList.add('recording');
  els.recBadge.classList.remove('hidden');
  els.exportJsonBtn.disabled = true;
  els.exportBvhBtn.disabled = true;
}

function stopRecording() {
  recorder.stop();
  els.recordBtn.textContent = '● Record';
  els.recordBtn.classList.remove('recording');
  els.recBadge.classList.add('hidden');
  const has = recorder.frameCount > 0;
  els.exportJsonBtn.disabled = !has;
  els.exportBvhBtn.disabled = !has;
  if (has) toast(`Recorded ${recorder.frameCount} frames — ready to export.`);
}

function applyMirrorClass() {
  els.video.classList.toggle('mirrored', state.mirror);
  els.overlay.classList.toggle('mirrored', state.mirror);
}
