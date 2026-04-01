/**
 * 50,000-particle point cloud with spring-mass physics.
 *
 * Two attractor states:
 *   GRID  – 3D rectangular lattice (no hands)
 *   POT   – surface-of-revolution vase (hands present)
 *
 * Gesture-driven sculpting:
 *   Wall Pull  – pinch attaches particles at Y-band to index tip
 *   Dyn Width  – two-hand palm distance scales pot radius
 *   Smoothing  – flat palm applies Laplacian smoothing
 *   Fist Reset – clenched fist returns pot to base shape
 *
 * Spring-mass model (semi-implicit Euler):
 *   vel = vel * (1 - D·dt) + K·dt * (target - pos)
 *   pos += vel · dt
 */

import * as THREE from 'three';

// ── Constants ───────────────────────────────────────────────────

const COUNT       = 50000;
const POT_HEIGHT  = 0.5;
const GRID_EXTENT = 0.42;

// Spring-mass: underdamped (ζ ≈ 0.50) for elastic clay feel
const SPRING_K = 120;
const SPRING_D = 11;

// Pot radius profile: bottom → top
const PROFILE = [
  0.06, 0.10, 0.13, 0.155, 0.14,
  0.11, 0.10, 0.13, 0.16, 0.15,
  0.13, 0.155,
];

const RINGS = 100;
const PPR   = Math.floor(COUNT / RINGS); // particles per ring

// ── Helpers ─────────────────────────────────────────────────────

function profileRadius(t) {
  const ct = t < 0 ? 0 : t > 1 ? 1 : t;
  const idx = ct * (PROFILE.length - 1);
  const lo = idx | 0;
  const hi = lo + 1 < PROFILE.length ? lo + 1 : lo;
  const f = idx - lo;
  return PROFILE[lo] * (1 - f) + PROFILE[hi] * f;
}

function lerp(a, b, t) {
  return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

function createGlowTexture() {
  const sz = 64;
  const c = document.createElement('canvas');
  c.width = sz; c.height = sz;
  const ctx = c.getContext('2d');
  const h = sz >> 1;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0.0,  'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.4,  'rgba(255,255,255,0.18)');
  g.addColorStop(1.0,  'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  return new THREE.CanvasTexture(c);
}

// ── Public API ──────────────────────────────────────────────────

export function createParticleSystem(scene) {

  // Typed arrays – zero allocations in the hot path
  const gridPos    = new Float32Array(COUNT * 3);
  const potPos     = new Float32Array(COUNT * 3);
  const sculptOff  = new Float32Array(COUNT * 3);
  const positions  = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);

  // ── Grid: 3D rectangular lattice ──────────────────────────────
  const dim = Math.ceil(Math.cbrt(COUNT));
  const spacing = GRID_EXTENT / dim;
  let idx = 0;
  for (let ix = 0; ix < dim && idx < COUNT; ix++) {
    for (let iy = 0; iy < dim && idx < COUNT; iy++) {
      for (let iz = 0; iz < dim && idx < COUNT; iz++) {
        const i3 = idx * 3;
        gridPos[i3]     = (ix - dim * 0.5 + 0.5) * spacing;
        gridPos[i3 + 1] = (iy - dim * 0.5 + 0.5) * spacing;
        gridPos[i3 + 2] = (iz - dim * 0.5 + 0.5) * spacing;
        idx++;
      }
    }
  }

  // ── Pot: surface of revolution with ring topology ─────────────
  idx = 0;
  for (let ring = 0; ring < RINGS && idx < COUNT; ring++) {
    const t = (ring + 0.5) / RINGS;
    const y = (t - 0.5) * POT_HEIGHT;
    const r = profileRadius(t);
    for (let p = 0; p < PPR && idx < COUNT; p++) {
      const angle = (p / PPR) * Math.PI * 2 + ring * 0.07;
      const jr = (Math.random() - 0.5) * 0.005;
      const i3 = idx * 3;
      potPos[i3]     = Math.cos(angle) * (r + jr);
      potPos[i3 + 1] = y + (Math.random() - 0.5) * 0.002;
      potPos[i3 + 2] = Math.sin(angle) * (r + jr);
      idx++;
    }
  }
  while (idx < COUNT) {
    const t = Math.random();
    const angle = Math.random() * Math.PI * 2;
    const r = profileRadius(t);
    const i3 = idx * 3;
    potPos[i3]     = Math.cos(angle) * r;
    potPos[i3 + 1] = (t - 0.5) * POT_HEIGHT;
    potPos[i3 + 2] = Math.sin(angle) * r;
    idx++;
  }

  // Start at grid
  positions.set(gridPos);

  // ── Three.js objects ──────────────────────────────────────────
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.005,
    map: createGlowTexture(),
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    color: 0xffffff,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  // ── Mutable state ─────────────────────────────────────────────
  let blend = 0;            // 0 = grid, 1 = pot
  let currentRScale = 1.0;  // smoothed radius scale
  let currentHScale = 1.0;  // smoothed height scale
  let frozen = false;

  // Hand-removal state machine:
  //   active → dissolving (2s hold, rotation decelerates) → fading (1.5s cubic ease to grid) → idle
  const DISSOLVE_HOLD = 2.0;
  const FADE_DURATION = 1.5;
  let handState = 'idle';
  let stateTimer = 0;
  let prevHasHands = false;
  let rotationDamping = 1.0;

  // ── Core update (called every frame) ──────────────────────────

  function update(gesture, dt) {
    if (frozen) return;

    const {
      hasHands,
      allTipsLocal  = [],
      wallPullers   = [],
      smoothPalms   = [],
      resetFist     = false,
      radiusScale   = 1.0,
      heightScale   = 1.0,
    } = gesture;

    // ── Hand-removal state machine ──
    if (hasHands) {
      handState = 'active';
      stateTimer = 0;
      rotationDamping = 1.0;
    } else if (prevHasHands) {
      handState = 'dissolving';
      stateTimer = 0;
    }
    prevHasHands = hasHands;

    if (handState === 'active') {
      blend = lerp(blend, 1, Math.min(1, dt * 3.5));
    } else if (handState === 'dissolving') {
      stateTimer += dt;
      rotationDamping = lerp(1.0, 0.3, Math.min(1, stateTimer / DISSOLVE_HOLD));
      blend = 1.0;
      if (stateTimer >= DISSOLVE_HOLD) {
        handState = 'fading';
        stateTimer = 0;
      }
    } else if (handState === 'fading') {
      stateTimer += dt;
      const t = Math.min(1, stateTimer / FADE_DURATION);
      blend = 1.0 - t * t * t;   // cubic ease-in: slow departure, accelerating dissolve
      rotationDamping = 0.3;
      if (t >= 1) {
        handState = 'idle';
        rotationDamping = 1.0;
      }
    } else {
      blend = lerp(blend, 0, Math.min(1, dt * 3.5));
      rotationDamping = 1.0;
    }

    // ── Smooth the radius and height scales ──
    currentRScale = lerp(currentRScale, radiusScale, Math.min(1, dt * 4));
    currentHScale = lerp(currentHScale, heightScale, Math.min(1, dt * 4));
    const rS = currentRScale;
    const hS = currentHScale;

    // ── 1. Fist reset: fast decay of sculpt offsets ──
    if (resetFist) {
      for (let k = 0; k < sculptOff.length; k++) {
        sculptOff[k] *= 0.88;
      }
    }

    // ── 2. Wall pulling (pinch > 0.8) ──
    for (let w = 0; w < wallPullers.length; w++) {
      const tip = wallPullers[w].tip;
      const tipR = Math.sqrt(tip.x * tip.x + tip.z * tip.z);
      const bandW = 0.08;

      for (let i = 0; i < COUNT; i++) {
        const i3 = i * 3;
        const py = potPos[i3 + 1] + sculptOff[i3 + 1];
        const yDist = Math.abs(py - tip.y);
        if (yDist > bandW) continue;

        const yFall = 1 - yDist / bandW;
        const str = 0.005 * yFall * yFall;

        const cx = potPos[i3] * rS + sculptOff[i3];
        const cz = potPos[i3 + 2] * rS + sculptOff[i3 + 2];
        const pr = Math.sqrt(cx * cx + cz * cz);
        if (pr < 0.004) continue;

        const rdx = cx / pr;
        const rdz = cz / pr;

        const radDelta = tipR - pr;
        sculptOff[i3]     += rdx * radDelta * str;
        sculptOff[i3 + 2] += rdz * radDelta * str;
        sculptOff[i3 + 1] += (tip.y - py) * str * 0.3;
      }
    }

    // ── 3. General hand proximity push ──
    if (hasHands && allTipsLocal.length > 0 && wallPullers.length === 0) {
      const infRSq = 0.018;  // 0.134² – tight radius
      const pStr = 0.0012;
      for (let i = 0; i < COUNT; i++) {
        const i3 = i * 3;
        const px = potPos[i3] * rS + sculptOff[i3];
        const py = potPos[i3 + 1] + sculptOff[i3 + 1];
        const pz = potPos[i3 + 2] * rS + sculptOff[i3 + 2];
        for (let h = 0; h < allTipsLocal.length; h++) {
          const hp = allTipsLocal[h];
          const d2 = (hp.x - px) ** 2 + (hp.y - py) ** 2 + (hp.z - pz) ** 2;
          if (d2 >= infRSq) continue;
          const d = Math.sqrt(d2);
          const f = pStr * (1 - d / 0.134);
          const pr = Math.sqrt(px * px + pz * pz);
          if (pr < 0.004) continue;
          sculptOff[i3]     += (px / pr) * f;
          sculptOff[i3 + 2] += (pz / pr) * f;
        }
      }
    }

    // ── 4. Laplacian smoothing (flat palm) — strong, immediate, 5cm radius ──
    const smoothR = 0.18;
    const smoothRSq = smoothR * smoothR;
    const smoothF = 0.38;
    const structured = RINGS * PPR; // only smooth ring-structured particles

    for (let s = 0; s < smoothPalms.length; s++) {
      const palm = smoothPalms[s].palm;

      for (let i = 0; i < structured; i++) {
        const i3 = i * 3;
        const px = potPos[i3] * rS + sculptOff[i3];
        const py = potPos[i3 + 1] + sculptOff[i3 + 1];
        const pz = potPos[i3 + 2] * rS + sculptOff[i3 + 2];

        const d2 = (palm.x - px) ** 2 + (palm.y - py) ** 2 + (palm.z - pz) ** 2;
        if (d2 > smoothRSq) continue;

        const ring = (i / PPR) | 0;
        const pos  = i % PPR;

        // 4-connected neighbors on the ring topology
        const left  = ring * PPR + (pos - 1 + PPR) % PPR;
        const right = ring * PPR + (pos + 1) % PPR;

        let avgX = sculptOff[left * 3] + sculptOff[right * 3];
        let avgY = sculptOff[left * 3 + 1] + sculptOff[right * 3 + 1];
        let avgZ = sculptOff[left * 3 + 2] + sculptOff[right * 3 + 2];
        let cnt  = 2;

        if (ring > 0) {
          const below = (ring - 1) * PPR + pos;
          avgX += sculptOff[below * 3];
          avgY += sculptOff[below * 3 + 1];
          avgZ += sculptOff[below * 3 + 2];
          cnt++;
        }
        if (ring < RINGS - 1) {
          const above = (ring + 1) * PPR + pos;
          avgX += sculptOff[above * 3];
          avgY += sculptOff[above * 3 + 1];
          avgZ += sculptOff[above * 3 + 2];
          cnt++;
        }

        avgX /= cnt; avgY /= cnt; avgZ /= cnt;

        const falloff = 1 - Math.sqrt(d2) / smoothR;
        const sf = smoothF * falloff;

        sculptOff[i3]     += (avgX - sculptOff[i3])     * sf;
        sculptOff[i3 + 1] += (avgY - sculptOff[i3 + 1]) * sf;
        sculptOff[i3 + 2] += (avgZ - sculptOff[i3 + 2]) * sf;
      }
    }

    // ── 5. Slow natural decay ──
    if (!resetFist) {
      for (let k = 0; k < sculptOff.length; k++) {
        sculptOff[k] *= 0.9985;
      }
    }

    // ── 6. Compute targets & spring physics ──
    const b  = blend;
    const ib = 1 - b;
    const velRetain  = 1 - SPRING_D * dt;
    const springPull = SPRING_K * dt;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;

      const tx = gridPos[i3]     * ib + (potPos[i3]     * rS + sculptOff[i3])     * b;
      const ty = gridPos[i3 + 1] * ib + (potPos[i3 + 1] * hS + sculptOff[i3 + 1]) * b;
      const tz = gridPos[i3 + 2] * ib + (potPos[i3 + 2] * rS + sculptOff[i3 + 2]) * b;

      velocities[i3]     = velocities[i3]     * velRetain + springPull * (tx - positions[i3]);
      velocities[i3 + 1] = velocities[i3 + 1] * velRetain + springPull * (ty - positions[i3 + 1]);
      velocities[i3 + 2] = velocities[i3 + 2] * velRetain + springPull * (tz - positions[i3 + 2]);

      positions[i3]     += velocities[i3]     * dt;
      positions[i3 + 1] += velocities[i3 + 1] * dt;
      positions[i3 + 2] += velocities[i3 + 2] * dt;
    }

    geo.attributes.position.needsUpdate = true;
  }

  function getDisplacementMagnitude() {
    let sum = 0;
    for (let i = 0; i < sculptOff.length; i++) {
      sum += Math.abs(sculptOff[i]);
    }
    return sum / sculptOff.length;
  }

  /**
   * Return a snapshot of all 50k particle positions as a plain array
   * of [x, y, z, x, y, z, ...] suitable for JSON serialization.
   */
  function getParticlePositions() {
    return Array.from(positions);
  }

  return {
    points,
    update,
    getDisplacementMagnitude,
    getParticlePositions,
    freeze()  { frozen = true; },
    unfreeze(){ frozen = false; },
    isFrozen(){ return frozen; },
    getRotationDamping() { return rotationDamping; },
  };
}
