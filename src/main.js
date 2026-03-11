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
import {
  initAudio, resumeAudio, updateSwoosh, loadSquishSound, playSquish,
} from './audio/audioManager.js';
import {
  captureWebcam, captureClayCanvas, capturePostcardAsImage, sendPostcardEmail,
} from './postcard/postcardManager.js';

// ── Config ──────────────────────────────────────────────────────

const EMAILJS_CONFIG = {
  publicKey: 'YOUR_PUBLIC_KEY',
  serviceId: 'YOUR_SERVICE_ID',
  templateId: 'YOUR_TEMPLATE_ID',
};

const LEAP_CONFIG = { scale: 0.002, offsetY: -0.15, offsetZ: 0 };

const BASELINE_PALM_DIST = 0.28;

// ── DOM ─────────────────────────────────────────────────────────

let canvas;
const leapStatus       = document.getElementById('leap-status');
const instructions     = document.getElementById('instructions');
const postcardOverlay  = document.getElementById('postcard-overlay');
const webcamSnapshot   = document.getElementById('webcam-snapshot');
const claySnapshot     = document.getElementById('clay-snapshot');
const postcardForm     = document.getElementById('postcard-form');
const sendStatus       = document.getElementById('send-status');
const closePostcardBtn = document.getElementById('close-postcard');
const postcardEl       = document.getElementById('postcard');

// Gesture guide indicators
const gPinch  = document.getElementById('g-pinch');
const gWidth  = document.getElementById('g-width');
const gSmooth = document.getElementById('g-smooth');
const gReset  = document.getElementById('g-reset');

// ── State ───────────────────────────────────────────────────────

let scene, camera, renderer, composer;
let particleSys;
let lastHandData    = [];   // per-hand rich data
let lastAllTips     = [];   // all palm+finger positions
let palmVelocityMag = 0;
let lastDisplacementMag = 0;
let leapConnected   = false;
let finishGestureCooldown = 0;
let lastTime = 0;

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

      // Two-hand pinch → finish
      if (finishGestureCooldown <= 0 && frame.hands.length >= 2) {
        const pinches = frame.hands.filter((h) => (h.pinchStrength || 0) > 0.7);
        if (pinches.length >= 2) {
          finishGestureCooldown = 90;
          triggerFinish();
        }
      }
      if (finishGestureCooldown > 0) finishGestureCooldown--;
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
  const hasHands = lastHandData.length > 0;
  const pts = particleSys.points;

  // Transform all tip positions to local space
  const allTipsLocal = lastAllTips.map((p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z);
    pts.worldToLocal(v);
    return { x: v.x, y: v.y, z: v.z };
  });

  const wallPullers = [];
  const smoothPalms = [];
  let resetFist   = false;
  let radiusScale = 1.0;
  let isWidthGesture = false;

  for (const hd of lastHandData) {
    if (!hd.palm) continue;

    const palmLocal = new THREE.Vector3(hd.palm.x, hd.palm.y, hd.palm.z);
    pts.worldToLocal(palmLocal);

    // Fist: grabStrength > 0.8 takes priority
    if (hd.grabStrength > 0.8) {
      resetFist = true;
    }
    // Pinch wall pull: pinchStrength > 0.8, not a fist
    else if (hd.pinchStrength > 0.8 && hd.indexTip) {
      const tipLocal = new THREE.Vector3(hd.indexTip.x, hd.indexTip.y, hd.indexTip.z);
      pts.worldToLocal(tipLocal);
      wallPullers.push({ tip: { x: tipLocal.x, y: tipLocal.y, z: tipLocal.z } });
    }
    // Flat palm smoothing: grabStrength < 0.2 and not pinching
    else if (hd.grabStrength < 0.2 && hd.pinchStrength < 0.3) {
      smoothPalms.push({ palm: { x: palmLocal.x, y: palmLocal.y, z: palmLocal.z } });
    }
  }

  // Dynamic width: distance between left and right palms
  if (lastHandData.length >= 2) {
    const left  = lastHandData.find((h) => h.type === 'left');
    const right = lastHandData.find((h) => h.type === 'right');
    if (left?.palm && right?.palm) {
      const palmDist = Math.abs(left.palm.x - right.palm.x);
      radiusScale = Math.max(0.35, Math.min(2.2, palmDist / BASELINE_PALM_DIST));
      isWidthGesture = true;
    }
  }

  // Update gesture guide highlights
  gPinch?.classList.toggle('gesture-active',  wallPullers.length > 0);
  gWidth?.classList.toggle('gesture-active',  isWidthGesture);
  gSmooth?.classList.toggle('gesture-active', smoothPalms.length > 0);
  gReset?.classList.toggle('gesture-active',  resetFist);

  return {
    hasHands,
    allTipsLocal,
    wallPullers,
    smoothPalms,
    resetFist,
    radiusScale,
  };
}

// ── Postcard ────────────────────────────────────────────────────

function triggerFinish() { showPostcard(); }

async function showPostcard() {
  postcardOverlay.classList.remove('hidden');
  try { webcamSnapshot.src = await captureWebcam(); }
  catch {
    webcamSnapshot.src =
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E' +
      '%3Crect fill="%23222" width="200" height="200"/%3E' +
      '%3Ctext fill="%23555" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo camera%3C/text%3E%3C/svg%3E';
  }
  claySnapshot.src = captureClayCanvas(canvas);
}

async function handleSendPostcard(e) {
  e.preventDefault();
  sendStatus.textContent = 'Sending…';
  try {
    const img = await capturePostcardAsImage(postcardEl);
    await sendPostcardEmail(EMAILJS_CONFIG, {
      to_email: document.getElementById('email-to').value,
      from_name: document.getElementById('from-name').value,
      message: document.getElementById('message').value,
      postcard_image: img,
    });
    sendStatus.textContent = 'Postcard sent!';
  } catch (err) { sendStatus.textContent = 'Failed: ' + err.message; }
}

// ── Animation Loop ──────────────────────────────────────────────

function animate(time = 0) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (time - lastTime) * 0.001);
  lastTime = time;

  // Pottery wheel rotation
  particleSys.points.rotation.y += 0.008;

  // Process gestures and feed to particle system
  const gesture = processGestures(dt);
  particleSys.update(gesture, dt);

  // Audio
  const mag = particleSys.getDisplacementMagnitude();
  if (mag > 0.001 && mag > lastDisplacementMag * 1.15) playSquish(mag);
  lastDisplacementMag = mag;
  updateSwoosh(palmVelocityMag);

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
  closePostcardBtn?.addEventListener('click', () => postcardOverlay.classList.add('hidden'));
  postcardForm?.addEventListener('submit', handleSendPostcard);

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
