// ---------------------------------------------------------------------------
// BlazePose / MediaPipe Pose landmark constants and small helpers.
//
// The model outputs 33 body landmarks in a fixed order. We also derive three
// "virtual" landmarks (hip center, shoulder center / neck, head center) that
// the retargeting layer uses as segment endpoints for the spine and head.
// ---------------------------------------------------------------------------

export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
  // Virtual landmarks (computed, appended after the 33 real ones):
  HIP_CENTER: 33,
  NECK: 34,        // midpoint of the shoulders
  HEAD_CENTER: 35, // midpoint of the ears
};

export const NUM_LANDMARKS = 33;
export const NUM_EXTENDED = 36;

// Bone-pair connections used to draw the 2D skeleton overlay on the video.
export const CONNECTIONS = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW], [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP], [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE], [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE], [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL], [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL], [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
  [LM.NOSE, LM.LEFT_EYE], [LM.NOSE, LM.RIGHT_EYE],
  [LM.LEFT_EYE, LM.LEFT_EAR], [LM.RIGHT_EYE, LM.RIGHT_EAR],
];

// Index pairs to swap when mirroring (left landmark <-> right landmark).
const MIRROR_PAIRS = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10],
  [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

/**
 * Mirror a landmark array in place-safe fashion (returns a new array):
 * negate x around the given center and swap every left/right pair.
 *
 * This is a true mathematical reflection: after it, the user's RIGHT arm
 * drives the character's LEFT arm, so on screen the character moves on the
 * same side as the (mirrored) webcam video — like looking into a mirror.
 *
 * @param {Array<{x,y,z,visibility}>} lms 33+ landmarks
 * @param {number} centerX x value to reflect around (0.5 for normalized
 *   screen coords, 0 for hip-centered world coords)
 */
export function mirrorLandmarks(lms, centerX = 0) {
  const out = lms.map((p) => ({ ...p, x: 2 * centerX - p.x }));
  for (const [a, b] of MIRROR_PAIRS) {
    const tmp = out[a];
    out[a] = out[b];
    out[b] = tmp;
  }
  return out;
}

/** Midpoint of two landmarks, averaging visibility. */
function mid(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

/**
 * Append the virtual landmarks (hip center, neck, head center) so the
 * retargeting config can reference them like any other landmark index.
 */
export function extendLandmarks(lms) {
  const out = lms.slice(0, NUM_LANDMARKS);
  out[LM.HIP_CENTER] = mid(lms[LM.LEFT_HIP], lms[LM.RIGHT_HIP]);
  out[LM.NECK] = mid(lms[LM.LEFT_SHOULDER], lms[LM.RIGHT_SHOULDER]);
  out[LM.HEAD_CENTER] = mid(lms[LM.LEFT_EAR], lms[LM.RIGHT_EAR]);
  return out;
}
