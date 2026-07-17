# LiteRT Mocap — browser-based motion capture

<img width="500" height="281" alt="mocap" src="https://github.com/user-attachments/assets/6701be40-bea1-465b-a538-068c2a1cf49e" />

Real-time human pose estimation running **entirely in the browser** with
[LiteRT.js](https://developers.google.com/edge/litert/web) (Google's on-device
AI runtime), driving a rigged 3D character in
[Three.js](https://threejs.org/). No server, no cloud calls — after
`npm install` everything (model, runtime, characters) is served locally and
works offline.

**Webcam → BlazePose (33 landmarks) → retargeting math → animated character**,
side by side on screen, with a live FPS / inference-latency HUD and a runtime
switch between WebGPU and CPU (XNNPACK/Wasm) acceleration.

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5173
```

That's it. `npm run dev` also copies the LiteRT Wasm runtime out of
`node_modules` into `public/litert-wasm/` (see `scripts/copy-wasm.mjs`).

Use Chrome (or any browser with WebGPU) for the fast path — the app detects
missing WebGPU and falls back to CPU with a visible notice.

## The pose model

`public/models/pose_landmark_full.tflite` ships with the repo — it's the
MediaPipe **BlazePose landmark (full)** model, 33 keypoints, ~6 MB,
Apache-2.0. If you need to re-download it:

```bash
curl -L -o public/models/pose_landmark_full.tflite \
  https://storage.googleapis.com/mediapipe-assets/pose_landmark_full.tflite
```

The same model (plus `lite`/`heavy` variants) is available via
[Kaggle Models (MediaPipe Pose)](https://www.kaggle.com/models/mediapipe/pose)
and the [LiteRT Hugging Face community](https://huggingface.co/litert-community).
The `lite` variant is faster on CPU; `heavy` is more accurate — both drop in
by replacing the file (input size and outputs are read from the model at load).

Note: this is the *landmark* half of the MediaPipe pose pipeline — it expects
a person-centered crop. Instead of shipping the separate detector model, the
app tracks a region of interest from the previous frame's landmarks
(`src/pose/detector.js`), exactly like MediaPipe does between detections.
Practical effect: tracking locks on within a frame or two of you being
roughly in view.

## The characters

Both ship in `public/characters/`, straight from the official
[three.js examples repo](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf)
(MIT-licensed):

- **RobotExpressive.glb** — fun on camera; an IK-style rig (its feet are
  parented to the armature root, which the retargeter handles with
  position-driven bones)
- **Xbot.glb** — a standard Mixamo humanoid rig; the cleanest demonstration
  of the retargeting

### Swapping in your own character (Mixamo, Ready Player Me, …)

1. Drop `YourCharacter.glb` into `public/characters/`
2. Add an entry to `src/retarget/characters.js` mapping its bone names to
   landmark segments (copy the `xbot` entry — for any Mixamo-named rig you
   mostly just adjust the `mixamorig:` prefix)

No retargeting code changes — all rig-specific knowledge lives in that one
config file, and it appears in the character dropdown automatically.

## How it's put together

```
src/
  main.js                 app orchestration: the inference + render loops
  camera.js               webcam capture with typed error states
  pose/
    detector.js           ★ LiteRT.js integration: load/compile the .tflite,
                            ROI tracking, tensor in/out, backend switching
    landmarks.js          BlazePose landmark constants, mirroring, virtual joints
    smoothing.js          One Euro filter (adaptive jitter removal)
  retarget/
    retarget.js           ★ the retargeting math: landmark positions →
                            bone quaternions (segment alignment + basis joints)
    characters.js         per-character bone maps (the only rig-specific file)
  scene.js                Three.js stage + character loader
  overlay.js              2D skeleton drawn over the video
  hud.js                  FPS / latency / backend readout
  exporter.js             session recorder + JSON and BVH export
  ui.js                   status layer, toasts
```

The two ★ files are heavily commented — they're the interesting parts.

### The retargeting idea in one paragraph

BlazePose outputs landmark *positions*; a rig needs bone *rotations*. For
each mapped bone we know which way it points in its bind pose (toward its
child bone). Each frame we compute the live direction of the matching body
segment (e.g. shoulder→elbow) in the bone's parent space, then apply the
shortest-arc rotation from bind direction to live direction on top of the
bind rotation — preserving the rig's built-in twist. The pelvis and chest
get full orientation bases (hip line / shoulder line × spine), which is what
makes the character lean and turn. Solving runs strictly parents-before-
children so every bone sees its parent's already-updated rotation. Details
in `src/retarget/retarget.js`.

## Features

- **Backend switch** (top bar): recompiles the model for WebGPU or CPU at
  runtime — watch the INFER number in the HUD change (~7 ms WebGPU vs ~25 ms
  CPU on an Apple-Silicon MacBook)
- **Mirror toggle**: true mathematical reflection (x-flip + left/right
  landmark swap) so the character moves like your mirror image
- **Partial-framing support**: in a typical face-to-hips webcam shot the
  model still *predicts* leg landmarks (extrapolated, low visibility). Each
  leg is gated on smoothed knee+ankle visibility with hysteresis: legs in
  frame are tracked, legs out of frame settle into the bind stance and only
  the upper body is driven. The HUD's TRACK row shows the current mode
  (FULL BODY / PARTIAL / UPPER BODY)
- **Record → Export JSON**: timestamped frames of world landmarks + every
  bone's local quaternion (+ root position); schema in `src/exporter.js`
- **Record → Export BVH**: imports into Blender via
  *File → Import → Motion Capture (.bvh)*. Rotations only (plus root
  position) — the robot's position-animated feet aren't representable in
  standard BVH, so use Xbot for BVH workflows
- **Graceful failure**: no WebGPU → CPU fallback with a toast; camera
  denied / missing, model download or compile failure → full-screen error
  card with instructions

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "WebGPU is not available" toast | Browser without WebGPU — CPU (Wasm) fallback is automatic; Chrome 113+ recommended |
| Stuck on "Requesting camera…" | Answer the permission prompt; check site permissions |
| Character doesn't move | Make sure your shoulders + hips are in frame — upper-body tracking needs the torso (legs are optional; see TRACK in the HUD) |
| Legs engage/disengage at the wrong point | Tune `GROUP_ENGAGE` / `GROUP_DISENGAGE` in `retarget.js` |
| Bones warned as missing in console | Your .glb's bone names don't match its `characters.js` entry (names are compared after Three.js sanitization, so `mixamorig:Hips` ≡ `mixamorigHips`) |
| Jittery motion | Raise smoothing: lower `minCutoff` in `main.js`'s smoothers or `ROTATION_SMOOTHING` in `retarget.js` |

## Credits

- Pose model: [MediaPipe BlazePose](https://developers.google.com/mediapipe)
  (Google, Apache-2.0)
- Runtime: [LiteRT.js](https://developers.google.com/edge/litert/web)
  (`@litertjs/core`, Apache-2.0)
- Characters: [three.js examples](https://github.com/mrdoob/three.js)
  (MIT); RobotExpressive originally by
  [Tomás Laulhé](https://www.patreon.com/quaternius), CC0
- Smoothing: the [One Euro filter](https://gery.casiez.net/1euro/)
  (Casiez, Roussel, Vogel)
