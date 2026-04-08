/**
 * 50,000-particle point cloud with spring-mass physics.
 *
 * Clay is always a simple vertical cylinder; sculpt offsets deform it in real time.
 *
 * Gesture-driven sculpting:
 *   Pinch carve  – axisymmetric (wheel profile): same inward push at every θ for a
 *                  given (radius, height), like real thrown clay — full circumference
 *   Dyn width    – two-hand palm distance scales cylinder radius
 *   Smoothing    – flat palm applies Laplacian smoothing
 *   Reset        – host passes resetSculpt to restore smooth cylinder
 *
 * Spring-mass model (semi-implicit Euler):
 *   vel = vel * (1 - D·dt) + K·dt * (target - pos)
 *   pos += vel · dt
 */

import * as THREE from 'three';

// ── Constants ───────────────────────────────────────────────────

const COUNT       = 50000;
const POT_HEIGHT  = 0.5;

/** Uniform cylinder radius (world units); sculpt offsets deform from this. */
const CYLINDER_RADIUS = 0.11;

// Spring-mass: underdamped (ζ ≈ 0.50) for elastic clay feel
const SPRING_K = 120;
const SPRING_D = 11;

const RINGS = 100;
const PPR   = Math.floor(COUNT / RINGS); // particles per ring

// Axisymmetric carve: elliptical tool in (r, y) — tall enough to shape full column; σy scales
// with pot height so top→bottom stays reachable as heightScale changes.
const CARVE_SIGMA_R = 0.052;
const CARVE_SIGMA_Y_MIN = 0.056;
const CARVE_SIGMA_Y_FRAC = 0.78; // × (POT_HEIGHT/2)*hS = half-height scale
const CARVE_STRENGTH = 0.019;

// ── Helpers ─────────────────────────────────────────────────────

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
  const potPos     = new Float32Array(COUNT * 3);
  const sculptOff  = new Float32Array(COUNT * 3);
  const positions  = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);

  // ── Clay: vertical cylinder (constant radius), ring topology ──
  let idx = 0;
  for (let ring = 0; ring < RINGS && idx < COUNT; ring++) {
    const t = (ring + 0.5) / RINGS;
    const y = (t - 0.5) * POT_HEIGHT;
    const r = CYLINDER_RADIUS;
    for (let p = 0; p < PPR && idx < COUNT; p++) {
      const angle = (p / PPR) * Math.PI * 2 + ring * 0.07;
      const jr = (Math.random() - 0.5) * 0.004;
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
    const r = CYLINDER_RADIUS;
    const i3 = idx * 3;
    potPos[i3]     = Math.cos(angle) * r;
    potPos[i3 + 1] = (t - 0.5) * POT_HEIGHT;
    potPos[i3 + 2] = Math.sin(angle) * r;
    idx++;
  }

  // Start as cylinder (not grid)
  positions.set(potPos);

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
  let currentRScale = 1.0;  // smoothed radius scale
  let currentHScale = 1.0;  // smoothed height scale
  let frozen = false;

  // ── Core update (called every frame) ──────────────────────────

  function update(gesture, dt) {
    if (frozen) return;

    const {
      sculptingEnabled = true,
      wallPullers   = [],
      smoothPalms   = [],
      resetSculpt   = false,
      radiusScale   = 1.0,
      heightScale   = 1.0,
    } = gesture;

    currentRScale = lerp(currentRScale, radiusScale, Math.min(1, dt * 4));
    currentHScale = lerp(currentHScale, heightScale, Math.min(1, dt * 4));
    const rS = currentRScale;
    const hS = currentHScale;

    // Reset sculpt toward smooth cylinder
    if (resetSculpt) {
      for (let k = 0; k < sculptOff.length; k++) {
        sculptOff[k] *= 0.88;
      }
    }

    if (sculptingEnabled) {

      // ── 1. Pinch carve: axisymmetric ellipse in (r, y) — full 360°, full height range ──
      const sigmaY = Math.max(
        CARVE_SIGMA_Y_MIN,
        CARVE_SIGMA_Y_FRAC * (0.5 * POT_HEIGHT) * hS,
      );
      const sR2 = CARVE_SIGMA_R * CARVE_SIGMA_R;
      const sY2 = sigmaY * sigmaY;

      for (let w = 0; w < wallPullers.length; w++) {
        const tip = wallPullers[w].tip;
        const rTip = Math.sqrt(tip.x * tip.x + tip.z * tip.z);

        for (let i = 0; i < COUNT; i++) {
          const i3 = i * 3;
          const px = potPos[i3] * rS + sculptOff[i3];
          const py = potPos[i3 + 1] * hS + sculptOff[i3 + 1];
          const pz = potPos[i3 + 2] * rS + sculptOff[i3 + 2];

          const pr = Math.sqrt(px * px + pz * pz);
          if (pr < 0.006) continue;

          const dr = pr - rTip;
          const dy = py - tip.y;
          const n = (dr * dr) / sR2 + (dy * dy) / sY2;
          if (n > 1) continue;
          const fall = 1 - Math.sqrt(n);
          const inward = CARVE_STRENGTH * fall * fall;

          const nx = px / pr;
          const nz = pz / pr;
          sculptOff[i3]     -= nx * inward;
          sculptOff[i3 + 2] -= nz * inward;
          sculptOff[i3 + 1] -= dy * 0.06 * inward;
        }
      }

      // ── 2. Laplacian smoothing (flat palm) — ring topology ──
      const smoothR = 0.18;
      const smoothRSq = smoothR * smoothR;
      const smoothF = 0.38;
      const structured = RINGS * PPR;

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

      // ── 3. Slow natural decay (clay relaxes slightly) ──
      if (!resetSculpt) {
        for (let k = 0; k < sculptOff.length; k++) {
          sculptOff[k] *= 0.9985;
        }
      }
    }

    // ── 4. Spring physics toward cylinder + sculpt ──
    const velRetain  = 1 - SPRING_D * dt;
    const springPull = SPRING_K * dt;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;

      const tx = potPos[i3]     * rS + sculptOff[i3];
      const ty = potPos[i3 + 1] * hS + sculptOff[i3 + 1];
      const tz = potPos[i3 + 2] * rS + sculptOff[i3 + 2];

      velocities[i3]     = velocities[i3]     * velRetain + springPull * (tx - positions[i3]);
      velocities[i3 + 1] = velocities[i3 + 1] * velRetain + springPull * (ty - positions[i3 + 1]);
      velocities[i3 + 2] = velocities[i3 + 2] * velRetain + springPull * (tz - positions[i3 + 2]);

      positions[i3]     += velocities[i3]     * dt;
      positions[i3 + 1] += velocities[i3 + 1] * dt;
      positions[i3 + 2] += velocities[i3 + 2] * dt;
    }

    geo.attributes.position.needsUpdate = true;
  }

  function lerp(a, b, t) {
    return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
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
    freeze()  { frozen = true; },
    unfreeze(){ frozen = false; },
    isFrozen(){ return frozen; },
    /** Wheel spin is constant (no grid dissolve). */
    getRotationDamping() { return 1.0; },
  };
}
