// Webcam capture. Resolves once the video has real dimensions, and throws
// typed errors so the UI can show a useful message (permission vs no device).

export async function startWebcam(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new WebcamError('unsupported', 'This browser does not support camera access.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new WebcamError('denied', 'Camera permission was denied. Allow camera access and reload the page.');
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      throw new WebcamError('missing', 'No camera was found on this device.');
    }
    throw new WebcamError('unknown', `Could not open the camera: ${err.message}`);
  }

  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    if (videoEl.readyState >= 2 && videoEl.videoWidth) return resolve();
    videoEl.onloadeddata = () => resolve();
  });
  await videoEl.play();
  return stream;
}

export class WebcamError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
