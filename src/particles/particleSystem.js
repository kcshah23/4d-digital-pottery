/**
 * Wheel clay: surface of revolution with per-ring radii + material-style forces.
 *
 * Volume heuristic: inward pinch removes radial mass → height grows slightly.
 * Pinch strength modulates edit rate (not instant snap).
 * Centrifugal outward force ∝ wheel speed²; pinch/flat palm stabilize toward axis.
 * Stationary hands + spin → friction jitter on points.
 * Thin wall (r < 10% of base) on upper column → slump lean.
 */

import * as THREE from 'three';

const COUNT = 50000;
const POT_HEIGHT = 0.5;
const CYLINDER_RADIUS = 0.11;
const PROFILE_MIN_R = 0.022;
const PROFILE_MAX_R = 0.42;

const RINGS = 100;
const PPR = Math.floor(COUNT / RINGS);

// Heavier springs (less snappy than 1:1 snap)
const SPRING_K = 68;
const SPRING_D = 17;

const PROFILE_RING_SIGMA = 0.82;
const PROFILE_EDIT_BASE = 0.022;
const PROFILE_SMOOTH_PASS = 0.12;

const PALM_PROFILE_SMOOTH = 0.38;
const PALM_RING_HALF = 8;

/** Volume lost to inward pinch → compensate by growing height (intrinsic scale bump per frame). */
const VOL_TO_HEIGHT = 0.55;
/** When top is compressed vs belly, nudge width (flattening rim → spread). */
const FLATTEN_SPREAD = 0.006;

const CENTRIF_COEF = 0.38;
const STABILIZE_RADIAL = 2.4;
const FRICTION_JITTER_AMP = 0.00042;
const FRICTION_JITTER_FREQ = 38;

const THIN_WALL_RATIO = 0.1;
const SLUMP_MAX = 0.045;
const BASE_RING_IDX = Math.min(RINGS - 3, Math.max(2, (RINGS * 0.18) | 0));

function createGlowTexture() {
  const sz = 64;
  const c = document.createElement('canvas');
  c.width = sz; c.height = sz;
  const ctx = c.getContext('2d');
  const h = sz >> 1;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  return new THREE.CanvasTexture(c);
}

function yToRingFloat(yInt) {
  let t = yInt / POT_HEIGHT + 0.5;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * RINGS - 0.5;
}

function radiusAtIntrinsicY(profile, yInt) {
  let t = yInt / POT_HEIGHT + 0.5;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const rf = t * RINGS - 0.5;
  if (rf <= 0) return profile[0];
  if (rf >= RINGS - 1) return profile[RINGS - 1];
  const r0 = rf | 0;
  const r1 = r0 + 1;
  const f = rf - r0;
  return profile[r0] * (1 - f) + profile[r1] * f;
}

function intrinsicVolume(profile, rS) {
  const dh = POT_HEIGHT / RINGS;
  let s = 0;
  for (let k = 0; k < RINGS; k++) {
    const r = profile[k] * rS;
    s += r * r;
  }
  return s * dh;
}

export function createParticleSystem(scene) {
  const potPos = new Float32Array(COUNT * 3);
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);

  const profile = new Float32Array(RINGS);
  for (let r = 0; r < RINGS; r++) profile[r] = CYLINDER_RADIUS;

  const profileScratch = new Float32Array(RINGS);
  const slumpX = new Float32Array(RINGS);

  let idx = 0;
  const ringPitch = POT_HEIGHT / RINGS;
  for (let ring = 0; ring < RINGS && idx < COUNT; ring++) {
    const t = (ring + 0.5) / RINGS;
    const y = (t - 0.5) * POT_HEIGHT;
    const r = CYLINDER_RADIUS;
    for (let p = 0; p < PPR && idx < COUNT; p++) {
      const angle = (p / PPR) * Math.PI * 2 + ring * 0.07;
      const jr = (Math.random() - 0.5) * 0.0025;
      const yJ = (Math.random() - 0.5) * ringPitch * 0.45;
      const i3 = idx * 3;
      potPos[i3] = Math.cos(angle) * (r + jr);
      potPos[i3 + 1] = y + yJ;
      potPos[i3 + 2] = Math.sin(angle) * (r + jr);
      idx++;
    }
  }
  while (idx < COUNT) {
    const t = Math.random();
    const angle = Math.random() * Math.PI * 2;
    const r = CYLINDER_RADIUS;
    const i3 = idx * 3;
    potPos[i3] = Math.cos(angle) * r;
    potPos[i3 + 1] = (t - 0.5) * POT_HEIGHT;
    potPos[i3 + 2] = Math.sin(angle) * r;
    idx++;
  }

  positions.set(potPos);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.006,
    map: createGlowTexture(),
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    color: 0xffffff,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  let currentRScale = 1.0;
  let currentHScale = 1.0;
  let volumeHeightBoost = 1.0;
  let ripplePhase = 0;
  let frozen = false;

  /**
   * Post–“save to gallery” only: smooth morph back to default cylinder.
   * Gated by `postSaveCylinderMorphActive` so normal sculpting never enters this path.
   */
  let postSaveCylinderMorphActive = false;
  let cylinderRestoreFrom = null;
  let cylinderRestoreR0 = 1;
  let cylinderRestoreH0 = 1;
  let cylinderRestoreVol0 = 1;
  let cylinderRestoreElapsed = 0;
  let cylinderRestoreDuration = 4;

  function resetProfileToCylinder() {
    for (let r = 0; r < RINGS; r++) profile[r] = CYLINDER_RADIUS;
    volumeHeightBoost = 1.0;
    for (let r = 0; r < RINGS; r++) slumpX[r] = 0;
  }

  function updateSlump(profileArr, rS) {
    const baseR = Math.max(PROFILE_MIN_R * 2, profileArr[BASE_RING_IDX] * rS);
    for (let k = 0; k < RINGS; k++) {
      slumpX[k] = 0;
      const yk = ((k + 0.5) / RINGS - 0.5) * POT_HEIGHT;
      if (yk < 0.02) continue;
      const rk = profileArr[k] * rS;
      if (rk < THIN_WALL_RATIO * baseR) {
        const t = 1 - rk / (THIN_WALL_RATIO * baseR);
        const u = t < 0 ? 0 : t > 1 ? 1 : t;
        slumpX[k] = SLUMP_MAX * u * u * (yk / (POT_HEIGHT * 0.5));
      }
    }
  }

  function update(gesture, dt) {
    if (frozen) return;

    const {
      sculptingEnabled = true,
      wallPullers = [],
      smoothPalms = [],
      resetSculpt = false,
      radiusScale = 1.0,
      heightScale = 1.0,
      wheelSpeed = 0.008,
      stabilizing = false,
      palmStationary = false,
    } = gesture;

    const restoring = postSaveCylinderMorphActive;

    if (!restoring) {
      currentRScale = lerp(currentRScale, radiusScale, Math.min(1, dt * 2.8));
      currentHScale = lerp(currentHScale, heightScale * volumeHeightBoost, Math.min(1, dt * 2.2));
    }

    let rS = currentRScale;
    let hS = currentHScale;

    if (resetSculpt && !restoring) {
      resetProfileToCylinder();
    }

    if (restoring) {
      cylinderRestoreElapsed += dt;
      let t = cylinderRestoreElapsed / cylinderRestoreDuration;
      if (t >= 1) {
        postSaveCylinderMorphActive = false;
        cylinderRestoreFrom = null;
        cylinderRestoreElapsed = 0;
        resetProfileToCylinder();
        currentRScale = 1;
        currentHScale = 1;
        rS = currentRScale;
        hS = currentHScale;
      } else {
        const u = t * t * (3 - 2 * t);
        for (let r = 0; r < RINGS; r++) {
          const a = cylinderRestoreFrom[r];
          profile[r] = a + (CYLINDER_RADIUS - a) * u;
        }
        currentRScale = cylinderRestoreR0 + (1 - cylinderRestoreR0) * u;
        currentHScale = cylinderRestoreH0 + (1 - cylinderRestoreH0) * u;
        volumeHeightBoost = cylinderRestoreVol0 + (1 - cylinderRestoreVol0) * u;
        rS = currentRScale;
        hS = currentHScale;
      }
    }

    const volBefore = intrinsicVolume(profile, rS);
    const invSigma2 = 1 / (2 * PROFILE_RING_SIGMA * PROFILE_RING_SIGMA);

    if (sculptingEnabled && !restoring) {
      for (let w = 0; w < wallPullers.length; w++) {
        const wp = wallPullers[w];
        const tip = wp.tip;
        const pinch = typeof wp.pinch01 === 'number' ? wp.pinch01 : 0.65;
        const pressure = pinch * pinch;

        const rTip = Math.sqrt(tip.x * tip.x + tip.z * tip.z);
        const yClay = tip.y;
        const yInt = yClay / hS;
        if (yInt < -0.5 * POT_HEIGHT || yInt > 0.5 * POT_HEIGHT) continue;

        const rWall = radiusAtIntrinsicY(profile, yInt) * rS;
        const delta = rTip - rWall;
        const band = 0.012;
        let dr0 = 0;
        if (delta < -band) {
          dr0 = PROFILE_EDIT_BASE * pressure * Math.min(1, (-delta - band) / 0.055) * dt * 18;
        } else if (delta > band) {
          dr0 = -PROFILE_EDIT_BASE * pressure * Math.min(1, (delta - band) / 0.055) * dt * 18;
        }
        if (dr0 === 0) continue;

        const dIntScale = dr0 / rS;
        const centerRf = yToRingFloat(yInt);

        for (let k = 0; k < RINGS; k++) {
          const dk = k - centerRf;
          const g = Math.exp(-dk * dk * invSigma2);
          if (g < 0.004) continue;
          let nv = profile[k] - dIntScale * g;
          if (nv < PROFILE_MIN_R) nv = PROFILE_MIN_R;
          if (nv > PROFILE_MAX_R) nv = PROFILE_MAX_R;
          profile[k] = nv;
        }
      }

      const topThird = ((RINGS * 2) / 3) | 0;
      let sumTop = 0;
      let sumMid = 0;
      let cTop = 0;
      let cMid = 0;
      for (let k = topThird; k < RINGS; k++) {
        sumTop += profile[k];
        cTop++;
      }
      for (let k = (RINGS / 3) | 0; k < (2 * RINGS) / 3; k++) {
        sumMid += profile[k];
        cMid++;
      }
      if (cTop > 0 && cMid > 0 && sumTop / cTop < (sumMid / cMid) * 0.88) {
        for (let k = 0; k < RINGS; k++) {
          let nv = profile[k] * (1 + FLATTEN_SPREAD * dt * 8);
          if (nv > PROFILE_MAX_R) nv = PROFILE_MAX_R;
          profile[k] = nv;
        }
      }

      for (let s = 0; s < smoothPalms.length; s++) {
        const entry = smoothPalms[s];
        const palm = entry.palm;
        const yClay = entry.clayY !== undefined ? entry.clayY : palm.y;
        const yInt = yClay / hS;
        if (yInt < -0.5 * POT_HEIGHT || yInt > 0.5 * POT_HEIGHT) continue;
        const cri = Math.max(0, Math.min(RINGS - 1, Math.round(yToRingFloat(yInt))));
        const lo = Math.max(1, cri - PALM_RING_HALF);
        const hi = Math.min(RINGS - 2, cri + PALM_RING_HALF);
        if (lo > hi) continue;
        for (let r = lo; r <= hi; r++) {
          profileScratch[r] =
            profile[r] + PALM_PROFILE_SMOOTH * (0.5 * (profile[r - 1] + profile[r + 1]) - profile[r]);
        }
        for (let r = lo; r <= hi; r++) {
          let nv = profileScratch[r];
          if (nv < PROFILE_MIN_R) nv = PROFILE_MIN_R;
          if (nv > PROFILE_MAX_R) nv = PROFILE_MAX_R;
          profile[r] = nv;
        }
      }
    }

    if (!restoring) {
      const volAfter = intrinsicVolume(profile, rS);
      if (volAfter < volBefore - 1e-8) {
        const loss = (volBefore - volAfter) / (volBefore + 1e-6);
        volumeHeightBoost += loss * VOL_TO_HEIGHT * dt * 6;
        volumeHeightBoost = Math.min(1.35, volumeHeightBoost);
      } else {
        volumeHeightBoost = lerp(volumeHeightBoost, 1.0, Math.min(1, dt * 0.15));
      }
    }

    updateSlump(profile, rS);

    const ws = Math.abs(wheelSpeed);
    const ws2 = ws * ws;
    const centrif = CENTRIF_COEF * ws2 * 420;
    const stab = stabilizing ? STABILIZE_RADIAL * (0.35 + 0.65 * (palmStationary ? 1 : 0.5)) : 0;
    ripplePhase += dt * FRICTION_JITTER_FREQ * ws * (palmStationary && stabilizing ? 1 : 0.2);

    const velRetain = 1 - SPRING_D * dt;
    const springPull = SPRING_K * dt;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      const yInt = potPos[i3 + 1];
      const ring = Math.min(RINGS - 1, Math.max(0, ((yToRingFloat(yInt) + 0.5) | 0)));
      const sl = slumpX[ring];

      const rMul = radiusAtIntrinsicY(profile, yInt) * rS;
      const pr0 = Math.sqrt(potPos[i3] * potPos[i3] + potPos[i3 + 2] * potPos[i3 + 2]);
      const inv = pr0 > 1e-6 ? rMul / pr0 : 1;

      let tx = potPos[i3] * inv + sl;
      const ty = yInt * hS;
      let tz = potPos[i3 + 2] * inv;

      const px = positions[i3];
      const py = positions[i3 + 1];
      const pz = positions[i3 + 2];
      const pr = Math.sqrt(px * px + pz * pz) + 1e-8;

      let vx = velocities[i3] * velRetain + springPull * (tx - px);
      let vy = velocities[i3 + 1] * velRetain + springPull * (ty - py);
      let vz = velocities[i3 + 2] * velRetain + springPull * (tz - pz);

      vx += (px / pr) * centrif * dt;
      vz += (pz / pr) * centrif * dt;

      if (stab > 0) {
        vx -= px * stab * dt;
        vz -= pz * stab * dt;
      }

      if (palmStationary && stabilizing && ws > 0.0025) {
        const j = FRICTION_JITTER_AMP * ws * 60;
        const ph = ripplePhase + i * 0.00013;
        vx += Math.sin(ph) * j;
        vy += Math.cos(ph * 1.3) * j * 0.5;
        vz += Math.cos(ph * 0.9) * j;
      }

      velocities[i3] = vx;
      velocities[i3 + 1] = vy;
      velocities[i3 + 2] = vz;

      positions[i3] += vx * dt;
      positions[i3 + 1] += vy * dt;
      positions[i3 + 2] += vz * dt;
    }

    geo.attributes.position.needsUpdate = true;
  }

  function lerp(a, b, t) {
    return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
  }

  function getDisplacementMagnitude() {
    let sum = 0;
    for (let r = 0; r < RINGS; r++) {
      sum += Math.abs(profile[r] - CYLINDER_RADIUS);
    }
    return sum / RINGS;
  }

  function getParticlePositions() {
    return Array.from(positions);
  }

  function setColor(hex) {
    mat.color.setHex(hex);
  }

  function getColorHex() {
    return `#${mat.color.getHexString()}`;
  }

  return {
    points,
    update,
    getDisplacementMagnitude,
    getParticlePositions,
    setColor,
    getColorHex,
    freeze() {
      frozen = true;
    },
    unfreeze() {
      frozen = false;
    },
    /**
     * Call only after a gallery save. Smoothstep morph to default cylinder over `durationSec`.
     * Does nothing for normal sculpt / R reset — those use the instant profile path.
     */
    beginPostSaveCylinderMorph(durationSec = 4) {
      postSaveCylinderMorphActive = true;
      if (!cylinderRestoreFrom) {
        cylinderRestoreFrom = new Float32Array(RINGS);
      }
      for (let r = 0; r < RINGS; r++) {
        cylinderRestoreFrom[r] = profile[r];
      }
      cylinderRestoreR0 = currentRScale;
      cylinderRestoreH0 = currentHScale;
      cylinderRestoreVol0 = volumeHeightBoost;
      cylinderRestoreElapsed = 0;
      cylinderRestoreDuration = Math.max(0.05, durationSec);
    },
    /** Stop a post-save morph without changing clay (e.g. before [R] instant reset). */
    cancelPostSaveCylinderMorph() {
      postSaveCylinderMorphActive = false;
      cylinderRestoreFrom = null;
      cylinderRestoreElapsed = 0;
    },
    isFrozen() {
      return frozen;
    },
    getRotationDamping() {
      return 1.0;
    },
  };
}
