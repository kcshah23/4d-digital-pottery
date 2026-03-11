/**
 * Clay vertex deformation engine.
 *
 * For each vertex, we compute the radial distance from the Y axis
 * and compare with each hand point's radial distance:
 *   - hand closer to axis than vertex → indent (push inward)
 *   - hand farther from axis → bulge (push outward)
 *
 * Displacement is smoothed over time for an organic feel.
 */

function lerp(a, b, t) {
  return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

/**
 * Apply deformation from hand positions to clay geometry.
 * All positions should be in clay-local space.
 */
export function applyDeformation(
  geometry,
  originalPositions,
  displacements,
  handPositions,
  params = {}
) {
  const {
    influenceRadius = 0.35,
    pushStrength = 0.06,
    smoothingFactor = 0.25,
    minRadius = 0.015,
  } = params;

  const invInfluence = 1 / influenceRadius;
  const posAttr = geometry.attributes.position;
  const posArray = posAttr.array;
  const count = posAttr.count;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const vx = originalPositions[i3];
    const vy = originalPositions[i3 + 1];
    const vz = originalPositions[i3 + 2];

    const vRadius = Math.sqrt(vx * vx + vz * vz);

    let targetX = 0;
    let targetY = 0;
    let targetZ = 0;

    if (vRadius >= minRadius) {
      const invR = 1 / vRadius;
      const radDirX = vx * invR;
      const radDirZ = vz * invR;

      for (let h = 0; h < handPositions.length; h++) {
        const hp = handPositions[h];

        const dx = hp.x - vx;
        const dy = hp.y - vy;
        const dz = hp.z - vz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist >= influenceRadius) continue;

        const falloff = 1 - dist * invInfluence;
        const strength = pushStrength * falloff * falloff * falloff;

        const handRadius = Math.sqrt(hp.x * hp.x + hp.z * hp.z);

        if (handRadius < vRadius) {
          targetX -= radDirX * strength;
          targetY -= dy * strength * 0.3;
          targetZ -= radDirZ * strength;
        } else {
          targetX += radDirX * strength;
          targetY += dy * strength * 0.3;
          targetZ += radDirZ * strength;
        }
      }
    }

    displacements[i3] = lerp(displacements[i3], targetX, smoothingFactor);
    displacements[i3 + 1] = lerp(displacements[i3 + 1], targetY, smoothingFactor);
    displacements[i3 + 2] = lerp(displacements[i3 + 2], targetZ, smoothingFactor);

    posArray[i3] = vx + displacements[i3];
    posArray[i3 + 1] = vy + displacements[i3 + 1];
    posArray[i3 + 2] = vz + displacements[i3 + 2];
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Slowly relax displacements when no hands are present.
 */
export function decayDisplacements(displacements, factor = 0.985) {
  for (let i = 0; i < displacements.length; i++) {
    displacements[i] *= factor;
  }
}
