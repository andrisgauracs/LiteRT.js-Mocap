// ---------------------------------------------------------------------------
// PoseDetector — the LiteRT.js integration.
//
// This wraps Google's LiteRT.js runtime (@litertjs/core) around the BlazePose
// "pose_landmark_full" .tflite model:
//
//   1. loadLiteRt()      — boots the LiteRT Wasm runtime (served from
//                          /litert-wasm/, copied out of node_modules).
//   2. loadAndCompile()  — compiles the .tflite model for an accelerator:
//                          'webgpu' (GPU compute shaders) or 'wasm' (XNNPACK
//                          on the CPU). Switching backends at runtime is just
//                          compiling a second copy and swapping the handle.
//   3. model.run()       — per frame: RGB pixels in, tensors out.
//
// The landmark model expects a person-centered square crop (in the full
// MediaPipe pipeline a separate detector model provides it). Instead of
// shipping a second model we do what MediaPipe itself does between
// detections: track a region of interest (ROI) from the previous frame's
// landmarks and crop to it. First frame = full frame; once the person is
// found, the crop tightens around them, which noticeably improves accuracy.
// ---------------------------------------------------------------------------

import { loadLiteRt, loadAndCompile, isWebGPUSupported, Tensor } from '@litertjs/core';
import { NUM_LANDMARKS } from './landmarks.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export class PoseDetector {
  constructor({ modelUrl = '/models/pose_landmark_full.tflite', wasmPath = '/litert-wasm/' } = {}) {
    this.modelUrl = modelUrl;
    this.wasmPath = wasmPath;
    this.model = null;         // current CompiledModel
    this.backend = null;       // 'webgpu' | 'wasm'
    this.modelBytes = null;    // cached .tflite bytes → backend switches never re-download
    this.inputW = 256;
    this.inputH = 256;
    this.outputMap = null;     // which output tensor is which, resolved by element count
    this.roi = null;           // {cx, cy, size} in video pixels — the tracked person crop
    this.lastInferMs = 0;

    // Offscreen canvas used to crop + resize the video frame to model input size.
    this.cropCanvas = document.createElement('canvas');
    this.cropCtx = this.cropCanvas.getContext('2d', { willReadFrequently: true });
  }

  /** Boot the LiteRT Wasm runtime. Call once, before compile(). */
  async init() {
    await loadLiteRt(this.wasmPath);
  }

  static webGpuAvailable() {
    return isWebGPUSupported();
  }

  /**
   * Download the .tflite file (with progress reporting), then compile it for
   * the requested accelerator. Safe to call again to switch backends.
   *
   * @param {'webgpu'|'wasm'} accelerator
   * @param {(fraction:number, label:string) => void} onProgress
   */
  async compile(accelerator, onProgress = () => {}) {
    if (!this.modelBytes) {
      this.modelBytes = await this.#fetchWithProgress(this.modelUrl, (f) =>
        onProgress(f * 0.7, 'Downloading pose model')
      );
    }
    onProgress(0.75, `Compiling for ${accelerator === 'webgpu' ? 'WebGPU' : 'CPU (XNNPACK)'}`);

    // loadAndCompile accepts raw bytes, so backend switches reuse the cached
    // download — important for the "fully offline after load" requirement.
    const compiled = await loadAndCompile(this.modelBytes, { accelerator });

    // Model input geometry, read from the model itself rather than hardcoded.
    const inputDetails = compiled.getInputDetails();
    const [, h, w] = inputDetails[0].shape; // NHWC: [1, 256, 256, 3]
    this.inputH = h;
    this.inputW = w;
    this.cropCanvas.width = w;
    this.cropCanvas.height = h;

    // The model has several outputs (landmarks, pose presence, segmentation
    // mask, heatmaps, world landmarks). Their order isn't guaranteed, so we
    // identify each by its element count:
    //   39 * 5 = 195  → screen landmarks (x, y, z, visibility, presence)
    //   39 * 3 = 117  → world landmarks (meters, origin at hip center)
    //   1             → pose presence score
    // (39 = 33 body landmarks + 6 auxiliary ones used internally by MediaPipe.)
    const outs = compiled.getOutputDetails();
    const count = (d) => d.shape.reduce((a, b) => a * b, 1);
    this.outputMap = {
      screen: outs.findIndex((d) => count(d) === 195),
      world: outs.findIndex((d) => count(d) === 117),
      score: outs.findIndex((d) => count(d) === 1),
    };
    if (this.outputMap.screen < 0 || this.outputMap.score < 0) {
      compiled.delete();
      throw new Error('Model outputs not recognized — is this a BlazePose landmark model?');
    }

    // Swap in the new model, dispose the old one.
    const old = this.model;
    this.model = compiled;
    this.backend = accelerator;
    if (old) old.delete();

    // Warm-up inference: the first WebGPU run compiles shader pipelines and
    // can take hundreds of ms — do it now so it doesn't hitch the live demo.
    onProgress(0.9, 'Warming up');
    const zeros = new Float32Array(this.inputW * this.inputH * 3);
    await this.#run(zeros);
    onProgress(1, 'Ready');
  }

  /**
   * Detect the pose in the current video frame.
   * @returns {null | {
   *   screen: Array<{x,y,z,visibility}>,  // normalized [0..1] video coords
   *   world:  Array<{x,y,z,visibility}>,  // meters, origin at hip center
   *   score: number, inferMs: number,
   * }}
   */
  async detect(video) {
    if (!this.model) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    if (!this.roi) this.roi = this.#fullFrameRoi(vw, vh);
    const roi = this.roi;

    // --- Preprocess: crop the ROI, resize to model input, normalize to [0,1].
    const pixels = this.#cropToInput(video, roi, vw, vh);
    const outputs = await this.#run(pixels);

    // The pose-presence output is already sigmoid-activated in this model;
    // if a variant ships raw logits instead, squash them ourselves.
    const rawScore = outputs.score[0];
    const score = rawScore >= 0 && rawScore <= 1 ? rawScore : sigmoid(rawScore);

    if (score < 0.5) {
      // Lost the person — reset to a full-frame search next frame.
      this.roi = this.#fullFrameRoi(vw, vh);
      return null;
    }

    // --- Decode screen landmarks: model space (pixels of the crop) → video space.
    const screen = [];
    const raw = outputs.screen;
    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const px = raw[i * 5 + 0] / this.inputW;   // [0..1] within the crop
      const py = raw[i * 5 + 1] / this.inputH;
      screen.push({
        x: (roi.cx - roi.size / 2 + px * roi.size) / vw,
        y: (roi.cy - roi.size / 2 + py * roi.size) / vh,
        z: (raw[i * 5 + 2] / this.inputW) * (roi.size / vw),
        visibility: sigmoid(raw[i * 5 + 3]),
      });
    }

    // --- Decode world landmarks: already meters around the hip center, which
    // is exactly what the retargeter wants (crop-independent 3D directions).
    let world;
    if (this.outputMap.world >= 0) {
      const rw = outputs.world;
      world = screen.map((s, i) => ({
        x: rw[i * 3 + 0],
        y: rw[i * 3 + 1],
        z: rw[i * 3 + 2],
        visibility: s.visibility,
      }));
    } else {
      world = this.#pseudoWorld(screen, vw, vh);
    }

    this.#updateRoi(screen, vw, vh);

    return { screen, world, score, inferMs: this.lastInferMs };
  }

  /** Fetch a binary file, reporting download progress when the server sends a length. */
  async #fetchWithProgress(url, onFraction) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download model (${res.status}) from ${url} — is the .tflite file in public/models/?`);
    }
    const total = Number(res.headers.get('Content-Length')) || 0;
    if (!res.body || !total) {
      return new Uint8Array(await res.arrayBuffer());
    }
    const reader = res.body.getReader();
    const bytes = new Uint8Array(total);
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value, received);
      received += value.length;
      onFraction(received / total);
    }
    return bytes;
  }

  // -------------------------------------------------------------------------
  // LiteRT.js inference: Float32Array → Tensor → model.run() → Float32Arrays.
  // -------------------------------------------------------------------------
  async #run(float32Pixels) {
    // Wrap the pixels in a LiteRT Tensor. Shape is NHWC.
    let input = new Tensor(float32Pixels, [1, this.inputH, this.inputW, 3]);
    try {
      if (this.backend === 'webgpu') {
        // Move the input onto the GPU so the whole graph runs there.
        input = await input.moveTo('webgpu');
      }
      const t0 = performance.now();
      const results = await this.model.run([input]);
      const data = {};
      for (const key of ['screen', 'world', 'score']) {
        const idx = this.outputMap[key];
        if (idx >= 0) data[key] = await this.#read(results[idx]);
      }
      this.lastInferMs = performance.now() - t0;
      for (const t of results) t.delete();
      return data;
    } finally {
      input.delete();
    }
  }

  /** Read a Tensor back to a TypedArray regardless of which device it's on. */
  async #read(tensor) {
    try {
      return await tensor.data();
    } catch {
      const cpu = await tensor.copyTo('wasm');
      const arr = cpu.toTypedArray().slice();
      cpu.delete();
      return arr;
    }
  }

  // -------------------------------------------------------------------------
  // ROI tracking + preprocessing helpers
  // -------------------------------------------------------------------------
  #fullFrameRoi(vw, vh) {
    const size = Math.max(vw, vh);
    return { cx: vw / 2, cy: vh / 2, size };
  }

  /** Tighten the crop around the person, based on this frame's landmarks. */
  #updateRoi(screen, vw, vh) {
    const cx = ((screen[23].x + screen[24].x) / 2) * vw; // hip center
    let maxR = 0;
    for (const p of screen) {
      if (p.visibility < 0.5) continue;
      const dx = p.x * vw - cx;
      const dy = p.y * vh - ((screen[23].y + screen[24].y) / 2) * vh;
      maxR = Math.max(maxR, Math.hypot(dx, dy));
    }
    const cy = ((screen[23].y + screen[24].y) / 2) * vh;
    let size = Math.max(maxR * 2 * 1.25, 0.3 * Math.max(vw, vh)); // pad 25%
    size = Math.min(size, 1.5 * Math.max(vw, vh));
    // Low-pass the ROI so the crop doesn't jump frame to frame.
    const a = 0.35;
    this.roi = {
      cx: this.roi.cx + (cx - this.roi.cx) * a,
      cy: this.roi.cy + (cy - this.roi.cy) * a,
      size: this.roi.size + (size - this.roi.size) * a,
    };
  }

  /** Crop the ROI square out of the video (black-padding beyond the edges). */
  #cropToInput(video, roi, vw, vh) {
    const ctx = this.cropCtx;
    const { inputW, inputH } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, inputW, inputH);

    const sx = roi.cx - roi.size / 2, sy = roi.cy - roi.size / 2;
    // Clip the source rect to the actual video bounds, and map the clipped
    // part to the matching sub-rect of the destination so nothing stretches.
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy);
    const cx1 = Math.min(vw, sx + roi.size), cy1 = Math.min(vh, sy + roi.size);
    if (cx1 > cx0 && cy1 > cy0) {
      const scale = inputW / roi.size;
      ctx.drawImage(
        video,
        cx0, cy0, cx1 - cx0, cy1 - cy0,
        (cx0 - sx) * scale, (cy0 - sy) * scale, (cx1 - cx0) * scale, (cy1 - cy0) * scale
      );
    }

    // RGBA bytes → RGB floats in [0, 1] (the model's expected input range).
    const rgba = ctx.getImageData(0, 0, inputW, inputH).data;
    const floats = new Float32Array(inputW * inputH * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) {
      floats[j++] = rgba[i] / 255;
      floats[j++] = rgba[i + 1] / 255;
      floats[j++] = rgba[i + 2] / 255;
    }
    return floats;
  }

  /** Fallback if a model variant lacks world-landmark output. */
  #pseudoWorld(screen, vw, vh) {
    const hipX = (screen[23].x + screen[24].x) / 2;
    const hipY = (screen[23].y + screen[24].y) / 2;
    // Rough meters-per-normalized-unit using torso length as ~0.5 m.
    const shX = (screen[11].x + screen[12].x) / 2, shY = (screen[11].y + screen[12].y) / 2;
    const torso = Math.hypot((shX - hipX) * vw, (shY - hipY) * vh) || 1;
    const s = 0.5 / torso;
    return screen.map((p) => ({
      x: (p.x - hipX) * vw * s,
      y: (p.y - hipY) * vh * s,
      z: p.z * vw * s,
      visibility: p.visibility,
    }));
  }

  dispose() {
    if (this.model) { this.model.delete(); this.model = null; }
  }
}
