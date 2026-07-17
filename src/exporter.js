// ---------------------------------------------------------------------------
// Session recording + export.
//
// While recording, every processed pose frame stores:
//   - timestamp
//   - the 33 world landmarks (meters, hip-centered)
//   - every skeleton bone's local rotation (and the root bone's position)
//
// Exports:
//   JSON — full data dump for custom tooling.
//   BVH  — standard mocap interchange; imports into Blender
//          (File → Import → Motion Capture (.bvh)) and After Effects tools.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

export class SessionRecorder {
  constructor() {
    this.recording = false;
    this.frames = [];
    this.boneList = null;   // [{name, node, parentIndex, offset}]
    this.startTime = 0;
    this.characterName = '';
  }

  /**
   * @param {THREE.Object3D} characterRoot the loaded character
   * @param {string} characterName for export metadata
   */
  start(characterRoot, characterName) {
    this.boneList = buildBoneList(characterRoot);
    this.frames = [];
    this.characterName = characterName;
    this.startTime = performance.now();
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  /** Capture one frame. Call after the retargeter has updated the rig. */
  capture(worldLandmarks, score) {
    if (!this.recording || !this.boneList) return;
    this.frames.push({
      t: (performance.now() - this.startTime) / 1000,
      score,
      landmarks: worldLandmarks.slice(0, 33).map((p) => [
        round(p.x), round(p.y), round(p.z), round(p.visibility),
      ]),
      rotations: this.boneList.map(({ node }) => [
        round(node.quaternion.x), round(node.quaternion.y),
        round(node.quaternion.z), round(node.quaternion.w),
      ]),
      rootPosition: [
        round(this.boneList[0].node.position.x),
        round(this.boneList[0].node.position.y),
        round(this.boneList[0].node.position.z),
      ],
    });
  }

  get frameCount() {
    return this.frames.length;
  }

  exportJSON() {
    const data = {
      format: 'litert-mocap/1',
      character: this.characterName,
      recordedAt: new Date().toISOString(),
      landmarkNames: 'MediaPipe BlazePose 33-point order',
      bones: this.boneList.map((b) => b.name),
      frameCount: this.frames.length,
      frames: this.frames,
    };
    download(
      new Blob([JSON.stringify(data)], { type: 'application/json' }),
      `mocap-${stamp()}.json`
    );
  }

  exportBVH() {
    if (!this.frames.length) return;
    download(new Blob([this.#buildBVH()], { type: 'text/plain' }), `mocap-${stamp()}.bvh`);
  }

  // BVH: a text skeleton hierarchy (rest offsets) followed by one line of
  // channel values per frame. Root gets position+rotation, joints rotation
  // only, written as intrinsic Z-X-Y euler angles in degrees.
  #buildBVH() {
    const bones = this.boneList;
    const lines = ['HIERARCHY'];
    const childrenOf = (i) => bones.filter((b) => b.parentIndex === i).map((b) => bones.indexOf(b));

    const writeJoint = (i, indent) => {
      const b = bones[i];
      const pad = '  '.repeat(indent);
      lines.push(`${pad}${i === 0 ? 'ROOT' : 'JOINT'} ${sanitize(b.name)}`);
      lines.push(`${pad}{`);
      lines.push(`${pad}  OFFSET ${b.offset.map(fmt).join(' ')}`);
      lines.push(
        `${pad}  CHANNELS ${i === 0 ? '6 Xposition Yposition Zposition ' : '3 '}Zrotation Xrotation Yrotation`
      );
      const kids = childrenOf(i);
      if (kids.length === 0) {
        lines.push(`${pad}  End Site`);
        lines.push(`${pad}  {`);
        lines.push(`${pad}    OFFSET 0.0 ${fmt(b.length || 0.01)} 0.0`);
        lines.push(`${pad}  }`);
      } else {
        for (const k of kids) writeJoint(k, indent + 1);
      }
      lines.push(`${pad}}`);
    };
    writeJoint(0, 0);

    const dt = this.frames.length > 1
      ? (this.frames[this.frames.length - 1].t - this.frames[0].t) / (this.frames.length - 1)
      : 1 / 30;
    lines.push('MOTION');
    lines.push(`Frames: ${this.frames.length}`);
    lines.push(`Frame Time: ${dt.toFixed(6)}`);

    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const deg = THREE.MathUtils.radToDeg;
    for (const frame of this.frames) {
      const vals = [...frame.rootPosition.map(fmt)];
      for (let i = 0; i < bones.length; i++) {
        q.fromArray(frame.rotations[i]);
        e.setFromQuaternion(q, 'ZXY'); // matches the channel order written above
        vals.push(fmt(deg(e.z)), fmt(deg(e.x)), fmt(deg(e.y)));
      }
      lines.push(vals.join(' '));
    }
    return lines.join('\n');
  }
}

/** Depth-first list of the character's bones, rooted at the first real bone. */
function buildBoneList(characterRoot) {
  let rootBone = null;
  characterRoot.traverse((n) => {
    if (!rootBone && n.isBone) rootBone = n;
  });
  if (!rootBone) throw new Error('Character has no bones');

  const list = [];
  const walk = (bone, parentIndex) => {
    const index = list.length;
    list.push({
      name: bone.name,
      node: bone,
      parentIndex,
      offset: [bone.position.x, bone.position.y, bone.position.z],
      length: bone.children.find((c) => c.isBone)?.position.length() ?? 0,
    });
    for (const c of bone.children) if (c.isBone) walk(c, index);
  };
  walk(rootBone, -1);
  return list;
}

const round = (x) => Math.round(x * 1e5) / 1e5;
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(4) : '0.0000');
const sanitize = (name) => name.replace(/[\s{}]/g, '_');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
