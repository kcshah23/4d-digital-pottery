/**
 * Leap Motion coordinate conversion and skeletal data extraction.
 *
 * Leap coordinate system (sensor facing up on desk):
 *   X: right,  Y: up (from sensor),  Z: toward user
 *   Typical palm: [0, 200, 0] mm hovering above sensor
 *
 * Three.js scene:
 *   Particle center at world (0, 0, 0)
 *   Camera at (0, 0.05, 1.0)
 */

export function leapToThree(leapVec, config = {}) {
  const {
    scale = 0.002,
    offsetY = -0.15,
    offsetZ = 0,
  } = config;

  const lx = leapVec[0] ?? leapVec.x;
  const ly = leapVec[1] ?? leapVec.y;
  const lz = leapVec[2] ?? leapVec.z;

  return {
    x: lx * scale,
    y: ly * scale + offsetY,
    z: -(lz * scale) + offsetZ,
  };
}

/**
 * Extract palm + all fingertip positions from a Leap hand.
 */
export function getHandPositions(hand, config = {}) {
  const positions = [];
  if (hand.palmPosition) {
    positions.push(leapToThree(hand.palmPosition, config));
  }
  for (let i = 0; i < 5 && hand.fingers; i++) {
    const finger = hand.fingers[i];
    if (finger && finger.tipPosition) {
      positions.push(leapToThree(finger.tipPosition, config));
    }
  }
  return positions;
}

/**
 * Find tip position of a specific finger type.
 * type: 0=thumb, 1=index, 2=middle, 3=ring, 4=pinky
 */
function fingerTip(hand, type, config) {
  if (!hand.fingers) return null;
  for (let i = 0; i < hand.fingers.length; i++) {
    if (hand.fingers[i].type === type && hand.fingers[i].tipPosition) {
      return leapToThree(hand.fingers[i].tipPosition, config);
    }
  }
  return null;
}

/**
 * Rich per-hand skeletal data for gesture recognition.
 */
export function getHandData(hand, config = {}) {
  return {
    type: hand.type || 'unknown',
    palm: hand.palmPosition ? leapToThree(hand.palmPosition, config) : null,
    indexTip: fingerTip(hand, 1, config),
    thumbTip: fingerTip(hand, 0, config),
    pinchStrength: hand.pinchStrength ?? 0,
    grabStrength: hand.grabStrength ?? 0,
    palmVelocity: hand.palmVelocity
      ? Math.sqrt(
          hand.palmVelocity[0] ** 2 +
          hand.palmVelocity[1] ** 2 +
          hand.palmVelocity[2] ** 2
        )
      : 0,
    palmVelocityY: hand.palmVelocity ? hand.palmVelocity[1] : 0,
    allTips: getHandPositions(hand, config),
  };
}
