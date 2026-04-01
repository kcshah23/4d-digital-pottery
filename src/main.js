/**
 * 4D Digital Pottery — Particle Cloud with Advanced Gestures
 *
 * Gesture map:
 *   [Pinch]      Index tip pulls/shapes walls at Y-band
 *   [Two Hands]  Palm distance scales pot radius
 *   [Flat Palm]  Laplacian smoothing evens the surface
 *   [Fist]       Resets clay to base pot shape
 *
 * Spring-mass physics give particles elastic, clay-like weight.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { getHandData, getHandPositions } from './utils/leapCoordinates.js';
import { createParticleSystem } from './particles/particleSystem.js';
import { initTrackingView, updateTrackingView, setTrackingColor } from './tracking/handVisualizer.js';
import {
  initAudio, resumeAudio, updateSwoosh, loadSquishSound, playSquish,
  updateContactBuzz, playWaterSquish, updateRotationHum,
} from './audio/audioManager.js';
import { captureClayCanvas } from './postcard/postcardManager.js';
import { uploadPostcardImage, saveToGallery } from './supabase/galleryService.js';

// ── Config ──────────────────────────────────────────────────────

const LEAP_CONFIG = { scale: 0.002, offsetY: -0.15, offsetZ: 0 };

const BASELINE_PALM_DIST = 0.28;

// 25 bright neon hues — glow-in-the-dark with bloom
const GLOW_PALETTE = [
  0xff00ff, // hot pink
  0x00ffff, // electric cyan
  0x39ff14, // neon green
  0xbf00ff, // vivid violet
  0xff6600, // electric orange
  0xff0066, // hot magenta
  0x00aaff, // laser blue
  0xccff00, // acid yellow
  0xff3366, // neon coral
  0x00ff88, // mint neon
  0xff4400, // blaze orange
  0x00ffcc, // turquoise
  0xff0099, // fuchsia
  0x7700ff, // deep purple
  0xffff00, // pure yellow
  0x00ff44, // emerald
  0xff2200, // neon red
  0x44bbff, // sky blue
  0xff88ff, // pastel pink
  0x00ffaa, // seafoam
  0xdd00ff, // electric purple
  0xaaff00, // chartreuse
  0xff5599, // rose
  0x00ddff, // ice blue
  0xffaa00, // amber
];
let colorIndex = Math.floor(Math.random() * GLOW_PALETTE.length);

function applyNextColor() {
  const hex = GLOW_PALETTE[colorIndex];
  particleSys.setColor(hex);
  setTrackingColor(hex);
  colorIndex = (colorIndex + 1) % GLOW_PALETTE.length;
}

// ── DOM ─────────────────────────────────────────────────────────

let canvas;
const leapStatus    = document.getElementById('leap-status');
const instructions  = document.getElementById('instructions');

// Save overlay
const saveOverlay   = document.getElementById('save-overlay');
const claySnapshot  = document.getElementById('clay-snapshot');
const saveForm      = document.getElementById('save-form');
const saveStatus    = document.getElementById('save-status');
const saveActions   = document.getElementById('save-actions');
const btnNewPot     = document.getElementById('btn-new-pot');
const btnViewGallery = document.getElementById('btn-view-gallery');


// Gesture guide indicators (remapped)
const gFist   = document.getElementById('g-fist');
const gSmooth = document.getElementById('g-smooth');
const gPinch  = document.getElementById('g-pinch');
const gWidth  = document.getElementById('g-width');

// Countdown + flash
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownText    = document.getElementById('countdown-text');
const flashOverlay     = document.getElementById('flash-overlay');

// ── State ───────────────────────────────────────────────────────

let scene, camera, renderer, composer;
let particleSys;
let lastHandData    = [];
let lastAllTips     = [];
let palmVelocityMag = 0;
let lastDisplacementMag = 0;
let leapConnected   = false;
let lastTime = 0;
let isFinishing = false;
let lastMaxPinch = 0;
let pinchCooldown = 0;

// Height control (two-hand Y velocity accumulation)
let heightTarget = 1.0;

// Width memory (hold last scale for 2s after two hands leave)
let twoHandsActive = false;
let twoHandsLostTime = 0;
let memorizedRadius = 1.0;
const WIDTH_HOLD = 2.0;
const WIDTH_FADE = 1.0;

// Fist-hold photo trigger (requires 1s hold to avoid accidental triggers)
let fistHoldTime = 0;
const FIST_HOLD_REQUIRED = 1.0;

// Raw LeapJS hands for tracking visualizer
let rawFrameHands = [];

// ── Three.js + Bloom ────────────────────────────────────────────

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.set(0, 0.05, 1.0);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.5, 0.12
  ));
  composer.addPass(new OutputPass());

  particleSys = createParticleSystem(scene);
}

// ── Leap Motion ─────────────────────────────────────────────────

let leapController = null;

function initLeap() {
  const Leap = typeof window !== 'undefined' ? window.Leap : null;
  if (!Leap) {
    leapStatus.textContent = 'Leap library not loaded — press F to finish';
    leapStatus.className = 'status-error';
    return;
  }

  leapController = Leap.loop(
    { host: '127.0.0.1', port: 6437, enableGestures: false },
    (frame) => {
      if (!frame.hands || frame.hands.length === 0) {
        lastHandData = [];
        lastAllTips  = [];
        rawFrameHands = [];
        palmVelocityMag *= 0.92;
        return;
      }

      if (!leapConnected) {
        leapConnected = true;
        leapStatus.textContent = 'Leap Motion: Tracking';
        leapStatus.className = 'status-connected';
        instructions.textContent =
          'Pinch to pull walls. Open both hands to set width. Flat palm smooths. Fist resets.';
      }

      const hands = [];
      const tips  = [];
      let velSum  = 0;

      for (const hand of frame.hands) {
        hands.push(getHandData(hand, LEAP_CONFIG));
        tips.push(...getHandPositions(hand, LEAP_CONFIG));
        if (hand.palmVelocity) {
          const v = hand.palmVelocity;
          velSum += Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
        }
      }

      lastHandData    = hands;
      lastAllTips     = tips;
      palmVelocityMag = velSum;
      rawFrameHands   = frame.hands;
    }
  );

  leapController.on('connect', () => {
    leapStatus.textContent = 'Leap Motion: Connected — move your hands';
    leapStatus.className = 'status-waiting';
  });
  leapController.on('disconnect', () => {
    leapConnected = false;
    leapStatus.textContent = 'Leap Motion: Disconnected';
    leapStatus.className = 'status-error';
  });

  leapStatus.textContent = 'Leap Motion: Connecting…';
  leapStatus.className = 'status-connecting';

  setTimeout(() => {
    if (!leapConnected && leapStatus.textContent.includes('Connecting')) {
      leapStatus.innerHTML =
        'Leap: No connection on 6437. Ensure bridge is running. ' +
        '<a href="#" id="leap-retry" style="color:#7eb;">Retry</a>';
      leapStatus.className = 'status-error';
      document.getElementById('leap-retry')?.addEventListener('click', (e) => {
        e.preventDefault();
        leapStatus.textContent = 'Retrying…';
        leapStatus.className = 'status-connecting';
        leapController.disconnect();
        setTimeout(() => leapController.connect(), 500);
      });
    }
  }, 5000);
}

// ── Gesture Processing ──────────────────────────────────────────

function processGestures(dt) {
  const now = performance.now() * 0.001;

  if (isFinishing) {
    gFist?.classList.remove('gesture-active');
    gSmooth?.classList.remove('gesture-active');
    gPinch?.classList.remove('gesture-active');
    gWidth?.classList.remove('gesture-active');
    fistHoldTime = 0;
    return { hasHands: false, allTipsLocal: [], wallPullers: [], smoothPalms: [], resetFist: false, radiusScale: 1.0, heightScale: heightTarget };
  }

  const hasHands = lastHandData.length > 0;
  const pts = particleSys.points;

  const allTipsLocal = lastAllTips.map((p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z);
    pts.worldToLocal(v);
    return { x: v.x, y: v.y, z: v.z };
  });

  const smoothPalms = [];
  let resetFist = false;
  let fistDetected = false;
  let radiusScale = 1.0;
  let isWidthGesture = false;

  for (const hd of lastHandData) {
    if (!hd.palm) continue;

    const palmLocal = new THREE.Vector3(hd.palm.x, hd.palm.y, hd.palm.z);
    pts.worldToLocal(palmLocal);

    // Fist → photo (grabStrength > 0.8)
    if (hd.grabStrength > 0.8) {
      fistDetected = true;
    }
    // Pinch → reset clay (pinchStrength > 0.9)
    else if (hd.pinchStrength > 0.9) {
      resetFist = true;
    }
    // Flat palm → smooth (low grab + low pinch, extended fingers)
    else if (hd.grabStrength < 0.2 && hd.pinchStrength < 0.3) {
      smoothPalms.push({ palm: { x: palmLocal.x, y: palmLocal.y, z: palmLocal.z } });
    }
  }

  // Fist hold timer → trigger photo after 1s
  if (fistDetected) {
    fistHoldTime += dt;
    if (fistHoldTime >= FIST_HOLD_REQUIRED) {
      triggerFinish();
      fistHoldTime = 0;
    }
  } else {
    fistHoldTime = 0;
  }

  // ── Two-hand controls: width + height ──
  if (lastHandData.length >= 2) {
    const left  = lastHandData.find((h) => h.type === 'left');
    const right = lastHandData.find((h) => h.type === 'right');

    // Width: horizontal palm distance
    if (left?.palm && right?.palm) {
      const palmDist = Math.abs(left.palm.x - right.palm.x);
      radiusScale = Math.max(0.35, Math.min(2.2, palmDist / BASELINE_PALM_DIST));
      memorizedRadius = radiusScale;
      twoHandsActive = true;
      isWidthGesture = true;
    }

    // Height: average Y velocity of both hands
    let avgYVel = 0;
    let velCount = 0;
    for (const hd of lastHandData) {
      if (hd.palmVelocityY !== undefined) {
        avgYVel += hd.palmVelocityY;
        velCount++;
      }
    }
    if (velCount > 0) {
      avgYVel /= velCount;
      if (Math.abs(avgYVel) > 50) {
        heightTarget += avgYVel * 0.0012 * dt;
        heightTarget = Math.max(0.4, Math.min(2.5, heightTarget));
      }
    }
  } else {
    // Width memory: hold for 2s then fade to 1.0
    if (twoHandsActive) {
      twoHandsLostTime = now;
      twoHandsActive = false;
    }
    const elapsed = now - twoHandsLostTime;
    if (twoHandsLostTime > 0 && elapsed < WIDTH_HOLD) {
      radiusScale = memorizedRadius;
    } else if (twoHandsLostTime > 0 && elapsed < WIDTH_HOLD + WIDTH_FADE) {
      const t = (elapsed - WIDTH_HOLD) / WIDTH_FADE;
      radiusScale = memorizedRadius + (1.0 - memorizedRadius) * t;
    }
  }

  // Update gesture guide highlights
  gFist?.classList.toggle('gesture-active', fistDetected && fistHoldTime > 0.3);
  gSmooth?.classList.toggle('gesture-active', smoothPalms.length > 0);
  gPinch?.classList.toggle('gesture-active', resetFist);
  gWidth?.classList.toggle('gesture-active', isWidthGesture);

  return {
    hasHands,
    allTipsLocal,
    wallPullers: [],
    smoothPalms,
    resetFist,
    radiusScale,
    heightScale: heightTarget,
  };
}

// ── Finish → Save to Gallery ─────────────────────────────────────

let capturedClayDataUrl = null;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function triggerFinish() {
  if (isFinishing) return;
  isFinishing = true;

  particleSys.freeze();

  countdownOverlay.classList.remove('hidden');

  const steps = [
    { text: '3', delay: 1000 },
    { text: '2', delay: 1000 },
    { text: '1', delay: 1000 },
  ];

  for (const step of steps) {
    countdownText.textContent = step.text;
    countdownText.style.animation = 'none';
    void countdownText.offsetHeight;
    countdownText.style.animation = '';
    await wait(step.delay);
  }

  flashOverlay.classList.remove('hidden');
  flashOverlay.style.animation = 'none';
  void flashOverlay.offsetHeight;
  flashOverlay.style.animation = '';

  capturedClayDataUrl = captureClayCanvas(canvas);

  await wait(650);
  flashOverlay.classList.add('hidden');
  countdownOverlay.classList.add('hidden');

  claySnapshot.src = capturedClayDataUrl;
  saveForm.classList.remove('hidden');
  saveActions.classList.add('hidden');
  saveStatus.textContent = '';
  saveOverlay.classList.remove('hidden');
}

async function handleSave(e) {
  e.preventDefault();
  const name = document.getElementById('potter-name').value.trim();
  if (!name) return;

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  saveStatus.textContent = 'Saving…';

  try {
    saveStatus.textContent = 'Uploading image…';
    const publicUrl = await uploadPostcardImage(capturedClayDataUrl, name);

    saveStatus.textContent = 'Saving to gallery…';
    const positions = particleSys.getParticlePositions();
    await saveToGallery({
      user_name: name,
      user_email: '',
      postcard_image_url: publicUrl,
      clay_model_data: { positions },
    });

    saveStatus.textContent = 'Saved! Opening gallery…';
    await wait(800);
    window.location.href = '/gallery.html';
  } catch (err) {
    const msg = err instanceof Error ? err.message : (err?.text || JSON.stringify(err));
    saveStatus.textContent = 'Failed: ' + msg;
    btn.disabled = false;
  }
}

function resetForNewPot() {
  saveOverlay.classList.add('hidden');
  particleSys.unfreeze();
  isFinishing = false;
  capturedClayDataUrl = null;
  document.getElementById('potter-name').value = '';
  document.getElementById('save-btn').disabled = false;
  applyNextColor();
}

// ── Animation Loop ──────────────────────────────────────────────

function animate(time = 0) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (time - lastTime) * 0.001);
  lastTime = time;

  // Pottery wheel rotation (respects dissolving damping + freeze)
  const rotSpeed = 0.008 * particleSys.getRotationDamping();
  if (!particleSys.isFrozen()) {
    particleSys.points.rotation.y += rotSpeed;
  }

  const gesture = processGestures(dt);
  particleSys.update(gesture, dt);

  // Audio: contact buzz (triangle osc modulated by palm distance from center)
  const palmDist = lastHandData.length > 0 && lastHandData[0].palm
    ? Math.sqrt(lastHandData[0].palm.x ** 2 + lastHandData[0].palm.z ** 2)
    : 0;
  updateContactBuzz(lastHandData.length > 0, palmDist);

  // Audio: rotation hum (60Hz sine scaled by wheel speed)
  updateRotationHum(rotSpeed);

  // Audio: water squish on pinch spike > 0.9
  const maxPinch = lastHandData.reduce((m, h) => Math.max(m, h.pinchStrength || 0), 0);
  if (maxPinch > 0.9 && lastMaxPinch <= 0.9 && pinchCooldown <= 0) {
    playWaterSquish();
    pinchCooldown = 20;
  }
  lastMaxPinch = maxPinch;
  if (pinchCooldown > 0) pinchCooldown--;

  // Audio: swoosh + deformation squish
  const mag = particleSys.getDisplacementMagnitude();
  if (mag > 0.001 && mag > lastDisplacementMag * 1.15) playSquish(mag);
  lastDisplacementMag = mag;
  updateSwoosh(palmVelocityMag);

  // Live tracking visualizer
  updateTrackingView(rawFrameHands);

  composer.render();
}

// ── Boot ────────────────────────────────────────────────────────

function boot() {
  const el = document.getElementById('canvas-3d');
  if (!el) { document.body.innerHTML = '<p style="color:red;padding:2rem;">Canvas not found.</p>'; return; }

  try { canvas = el; initAudio(); initThree(); }
  catch (e) { document.body.innerHTML = `<p style="color:red;padding:2rem;font-family:monospace;">${e.message}</p>`; return; }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') triggerFinish(); });

  saveForm?.addEventListener('submit', handleSave);
  btnNewPot?.addEventListener('click', resetForNewPot);
  btnViewGallery?.addEventListener('click', () => { window.location.href = '/gallery.html'; });

  initTrackingView(camera);
  applyNextColor();
  animate();
  initLeap();
}

function onFirstInteraction() {
  resumeAudio(); loadSquishSound();
  document.removeEventListener('click', onFirstInteraction);
  document.removeEventListener('keydown', onFirstInteraction);
}
document.addEventListener('click', onFirstInteraction);
document.addEventListener('keydown', onFirstInteraction);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
