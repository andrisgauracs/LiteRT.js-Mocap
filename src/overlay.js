// 2D skeleton overlay drawn on top of the webcam video.
// Coordinates arrive normalized to the video frame; the canvas is CSS-mirrored
// together with the <video>, so no coordinate flipping happens here.

import { CONNECTIONS, NUM_LANDMARKS } from './pose/landmarks.js';

export class Overlay {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d');
  }

  // The video uses object-fit: cover, so we mimic that mapping: scale the
  // video frame up to fill the element and crop the overflow equally.
  #coverTransform() {
    const cw = this.canvas.width, ch = this.canvas.height;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const scale = Math.max(cw / vw, ch / vh);
    return {
      sx: vw * scale,
      sy: vh * scale,
      ox: (cw - vw * scale) / 2,
      oy: (ch - vh * scale) / 2,
    };
  }

  draw(screenLandmarks) {
    const { canvas, ctx } = this;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!screenLandmarks) return;

    const t = this.#coverTransform();
    const px = (p) => ({ x: t.ox + p.x * t.sx, y: t.oy + p.y * t.sy });

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [a, b] of CONNECTIONS) {
      const pa = screenLandmarks[a], pb = screenLandmarks[b];
      if (pa.visibility < 0.5 || pb.visibility < 0.5) continue;
      const A = px(pa), B = px(pb);
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.85)';
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }

    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const p = screenLandmarks[i];
      if (p.visibility < 0.5) continue;
      const P = px(p);
      ctx.fillStyle = '#e6edf3';
      ctx.beginPath();
      ctx.arc(P.x, P.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
