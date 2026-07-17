// ---------------------------------------------------------------------------
// Character definitions — everything rig-specific lives HERE, so the
// retargeting math in retarget.js stays 100% character-agnostic.
//
// To add a new rigged .glb (Mixamo, Ready Player Me, ...):
//   1. Drop the file in public/characters/
//   2. Add an entry below mapping its bone names to landmark segments.
// That's the whole job — no retargeting code changes.
//
// Config format:
//   url            — path to the .glb
//   targetHeight   — world-units height the character is auto-scaled to
//   pelvis / chest — basis-driven bones (full 3D orientation from the hip
//                    line / shoulder line + spine direction)
//   segments       — direction-driven bones. Each entry:
//        bone:  bone node name in the glb
//        child: bone whose rest offset defines which way `bone` points in
//               its bind pose (usually its anatomical child)
//        from/to: landmark names (see LM in pose/landmarks.js) whose world
//               positions define the live direction this bone should point
//   positionBones  — bones driven by landmark POSITION rather than rotation.
//                    Needed for IK-style rigs (RobotExpressive parents its
//                    feet to the armature root, not to the legs).
// ---------------------------------------------------------------------------

export const CHARACTERS = {
  robot: {
    label: 'Robot (Three.js RobotExpressive)',
    url: '/characters/RobotExpressive.glb',
    targetHeight: 1.7,
    pelvis: { bone: 'Hips' },
    chest: { bone: 'Torso' },
    segments: [
      // spine: hip center -> shoulder center
      { bone: 'Abdomen', child: 'Torso', from: 'HIP_CENTER', to: 'NECK' },
      // head: shoulder center -> ear center
      { bone: 'Neck', child: 'Head', from: 'NECK', to: 'HEAD_CENTER' },
      { bone: 'Head', child: 'Head_end', from: 'NECK', to: 'HEAD_CENTER' },
      // arms
      { bone: 'UpperArm.L', child: 'LowerArm.L', from: 'LEFT_SHOULDER', to: 'LEFT_ELBOW' },
      { bone: 'LowerArm.L', child: 'Palm2.L', from: 'LEFT_ELBOW', to: 'LEFT_WRIST' },
      { bone: 'UpperArm.R', child: 'LowerArm.R', from: 'RIGHT_SHOULDER', to: 'RIGHT_ELBOW' },
      { bone: 'LowerArm.R', child: 'Palm2.R', from: 'RIGHT_ELBOW', to: 'RIGHT_WRIST' },
      // legs (feet are handled by positionBones — see note above)
      { bone: 'UpperLeg.L', child: 'LowerLeg.L', from: 'LEFT_HIP', to: 'LEFT_KNEE' },
      { bone: 'LowerLeg.L', child: 'LowerLeg.L_end', from: 'LEFT_KNEE', to: 'LEFT_ANKLE' },
      { bone: 'UpperLeg.R', child: 'LowerLeg.R', from: 'RIGHT_HIP', to: 'RIGHT_KNEE' },
      { bone: 'LowerLeg.R', child: 'LowerLeg.R_end', from: 'RIGHT_KNEE', to: 'RIGHT_ANKLE' },
    ],
    positionBones: [
      // RobotExpressive is an IK rig: foot bones hang off the armature root.
      // We place them at the ankle landmark (scaled to character proportions).
      { bone: 'Foot.L', landmark: 'LEFT_ANKLE' },
      { bone: 'Foot.R', landmark: 'RIGHT_ANKLE' },
    ],
    // Reference leg used to compute the human->character scale for positions.
    legChain: { hip: 'UpperLeg.L', knee: 'LowerLeg.L', ankleEnd: 'LowerLeg.L_end' },
  },

  xbot: {
    label: 'X Bot (Mixamo rig)',
    url: '/characters/Xbot.glb',
    targetHeight: 1.7,
    pelvis: { bone: 'mixamorig:Hips' },
    chest: { bone: 'mixamorig:Spine2' },
    segments: [
      { bone: 'mixamorig:Spine', child: 'mixamorig:Spine1', from: 'HIP_CENTER', to: 'NECK' },
      { bone: 'mixamorig:Spine1', child: 'mixamorig:Spine2', from: 'HIP_CENTER', to: 'NECK' },
      { bone: 'mixamorig:Neck', child: 'mixamorig:Head', from: 'NECK', to: 'HEAD_CENTER' },
      { bone: 'mixamorig:Head', child: 'mixamorig:HeadTop_End', from: 'NECK', to: 'HEAD_CENTER' },
      { bone: 'mixamorig:LeftArm', child: 'mixamorig:LeftForeArm', from: 'LEFT_SHOULDER', to: 'LEFT_ELBOW' },
      { bone: 'mixamorig:LeftForeArm', child: 'mixamorig:LeftHand', from: 'LEFT_ELBOW', to: 'LEFT_WRIST' },
      { bone: 'mixamorig:RightArm', child: 'mixamorig:RightForeArm', from: 'RIGHT_SHOULDER', to: 'RIGHT_ELBOW' },
      { bone: 'mixamorig:RightForeArm', child: 'mixamorig:RightHand', from: 'RIGHT_ELBOW', to: 'RIGHT_WRIST' },
      { bone: 'mixamorig:LeftUpLeg', child: 'mixamorig:LeftLeg', from: 'LEFT_HIP', to: 'LEFT_KNEE' },
      { bone: 'mixamorig:LeftLeg', child: 'mixamorig:LeftFoot', from: 'LEFT_KNEE', to: 'LEFT_ANKLE' },
      { bone: 'mixamorig:LeftFoot', child: 'mixamorig:LeftToeBase', from: 'LEFT_HEEL', to: 'LEFT_FOOT_INDEX' },
      { bone: 'mixamorig:RightUpLeg', child: 'mixamorig:RightLeg', from: 'RIGHT_HIP', to: 'RIGHT_KNEE' },
      { bone: 'mixamorig:RightLeg', child: 'mixamorig:RightFoot', from: 'RIGHT_KNEE', to: 'RIGHT_ANKLE' },
      { bone: 'mixamorig:RightFoot', child: 'mixamorig:RightToeBase', from: 'RIGHT_HEEL', to: 'RIGHT_FOOT_INDEX' },
    ],
    positionBones: [],
  },
};

export const DEFAULT_CHARACTER = 'robot';
