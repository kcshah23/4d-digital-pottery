/**
 * 4D Digital Pottery — wheel clay with material-style forces
 *
 *   [Pinch]      Pressure-scaled radial edits (depth → height on pot); volume → height boost
 *   [Flat Palm]  Stabilizes + smooths profile; friction ripple when still vs spin
 *   [Two Hands]  Overall width & height
 *   [Fist]       Finish / photo   [R]  Reset clay
 *
 * Centrifugal force ∝ wheel speed; pinch/palm counteract. Thin walls slump.
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
import { pickCuratorialFact, pickCuratorialFactForShape } from './gallery/potteryFacts.js';
import { computePotShapeHint } from './gallery/potShapeProfile.js';
import { pickPotQuote } from './gallery/potQuotes.js';
import { uploadPostcardImage, saveToGallery } from './supabase/galleryService.js';
import { notifyGalleryListUpdated, GALLERY_WINDOW_NAME } from './gallerySyncChannel.js';

// ── Config ──────────────────────────────────────────────────────

const LEAP_CONFIG = { scale: 0.002, offsetY: -0.15, offsetZ: 0 };

/** Matches `POT_HEIGHT` in particleSystem — clay occupies ±(this/2)*heightScale on Y. */
const CLAY_POT_HEIGHT = 0.5;

/**
 * Depth from Leap (scene Z) → height along pot. Farther from sensor → rim; closer → foot.
 */
function mapHandDepthToClayColumn(sensorZ, heightScale) {
  const half = 0.5 * CLAY_POT_HEIGHT * heightScale;
  const yBottom = -half;
  const yTop = half;
  const zNearBottom = 0.11;
  const zFarTop = -0.36;
  const t = (sensorZ - zNearBottom) / (zFarTop - zNearBottom);
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return yBottom + u * (yTop - yBottom);
}

const BASELINE_PALM_DIST = 0.28;

const PINCH_CARVE_MIN = 0.36;

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

/** Current on-screen color (particles + tracking). Updated each tween frame. */
let currentColorRGB = hexToRgb(GLOW_PALETTE[colorIndex]);
/** Active tween state; null means no tween running. */
let colorTween = null;
/** Duration for a single palette hop (s). Longer = more gradual. */
const COLOR_TWEEN_SEC = 1.2;

function hexToRgb(hex) {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

function rgbToHex({ r, g, b }) {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Called every animation frame; advances an active color tween and pushes it to the scene. */
function tickColorTween(dt) {
  if (!colorTween) return;
  colorTween.elapsed += dt;
  const raw = Math.min(1, colorTween.elapsed / colorTween.duration);
  const t = easeInOutCubic(raw);
  const { from, to } = colorTween;
  currentColorRGB = {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
  const hex = rgbToHex(currentColorRGB);
  particleSys.setColor(hex);
  setTrackingColor(hex);
  if (raw >= 1) colorTween = null;
}

/**
 * Smoothly cross-fade particles + hand tracking to the next palette color.
 * Interruptible: calling again mid-tween smoothly redirects from the current color.
 */
function applyNextColor() {
  const targetHex = GLOW_PALETTE[colorIndex];
  colorTween = {
    from: { ...currentColorRGB },
    to: hexToRgb(targetHex),
    elapsed: 0,
    duration: COLOR_TWEEN_SEC,
  };
  colorIndex = (colorIndex + 1) % GLOW_PALETTE.length;
}

/** Snap color instantly (used once at boot so we don't start mid-fade from black). */
function initColorImmediate() {
  const hex = GLOW_PALETTE[colorIndex];
  currentColorRGB = hexToRgb(hex);
  particleSys.setColor(hex);
  setTrackingColor(hex);
  colorIndex = (colorIndex + 1) % GLOW_PALETTE.length;
  colorTween = null;
}

// ── DOM ─────────────────────────────────────────────────────────

let canvas;
const leapStatus    = document.getElementById('leap-status');

// Save overlay
const saveOverlay   = document.getElementById('save-overlay');
const claySnapshot  = document.getElementById('clay-snapshot');
const saveForm      = document.getElementById('save-form');
const saveStatus    = document.getElementById('save-status');
const saveActions   = document.getElementById('save-actions');
const btnNewPot     = document.getElementById('btn-new-pot');
const btnViewGallery = document.getElementById('btn-view-gallery');


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
/** WebSocket to Leap bridge is up (distinct from `leapConnected`, which requires visible hands). */
let leapSocketConnected = false;
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

/** After gallery save, morph clay back to default cylinder (seconds). */
const POST_SAVE_CYLINDER_TRANSITION_SEC = 4;

/** Curatorial fact + pot quote for this session; chosen at session start (same as gallery save). */
let sessionCuratorialFact = null;
let sessionPotQuote = null;
let pendingCylinderReset = false;

// Fist-hold photo trigger (requires 1s hold to avoid accidental triggers)
let fistHoldTime = 0;
const FIST_HOLD_REQUIRED = 1.0;
/**
 * After a photo/save flow, require the hand to open back up (non-fist) before we
 * accept another fist-hold trigger; prevents an auto-refire when the user's hand
 * is still curled while returning to sculpting.
 */
let fistArmed = true;
const FIST_REARM_GRAB_BELOW = 0.3;

// Raw LeapJS hands for tracking visualizer
let rawFrameHands = [];

/** Set in animate() from wheel rotation speed (passed into particle physics). */
let lastWheelSpeed = 0.008;

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
let leapReconnectTimer = null;
let leapWatchdogTimer = null;
let leapStartupTimeoutId = null;
let leapReconnectAttempt = 0;

function clearLeapReconnectTimers() {
  if (leapReconnectTimer) {
    clearTimeout(leapReconnectTimer);
    leapReconnectTimer = null;
  }
  if (leapWatchdogTimer) {
    clearTimeout(leapWatchdogTimer);
    leapWatchdogTimer = null;
  }
}

/** Disconnect then reconnect WebSocket (same path as manual Retry). */
function pulseLeapReconnect() {
  if (!leapController) return;
  leapStatus.textContent = 'Leap Motion: Reconnecting…';
  leapStatus.className = 'status-connecting';
  try {
    leapController.disconnect();
  } catch (_) { /* noop */ }
  setTimeout(() => {
    try {
      leapController.connect();
    } catch (_) { /* noop */ }
  }, 500);
}

function scheduleNextLeapReconnect() {
  if (!leapController) return;
  clearLeapReconnectTimers();
  const wait = Math.min(450 + leapReconnectAttempt * 550, 15000);
  leapReconnectTimer = setTimeout(() => {
    leapReconnectTimer = null;
    leapStatus.textContent =
      leapReconnectAttempt === 0
        ? 'Leap Motion: Disconnected — reconnecting…'
        : 'Leap Motion: Reconnecting…';
    leapStatus.className = 'status-connecting';
    try {
      leapController.disconnect();
    } catch (_) { /* noop */ }
    setTimeout(() => {
      try {
        leapController.connect();
      } catch (_) { /* noop */ }
      leapReconnectAttempt++;
      leapWatchdogTimer = setTimeout(() => {
        leapWatchdogTimer = null;
        if (!leapSocketConnected && leapController) {
          scheduleNextLeapReconnect();
        }
      }, 10000);
    }, 500);
  }, wait);
}

function wireLeapRetryLink() {
  if (leapSocketConnected) return;
  leapStatus.innerHTML =
    'Leap: No connection on <code>127.0.0.1:6437</code>. Start the bridge: <code>npm run dev</code> ' +
    '(not <code>dev:vite</code> alone). If the bridge is built: <code>npm run setup-leap-bridge</code>. ' +
    '<a href="#" id="leap-retry" style="color:#7eb;">Retry</a>';
  leapStatus.className = 'status-error';
}

function onLeapRetryClick(e) {
  const a = e.target?.closest?.('a#leap-retry');
  if (!a) return;
  e.preventDefault();
  leapReconnectAttempt = 0;
  clearLeapReconnectTimers();
  leapStatus.textContent = 'Retrying…';
  leapStatus.className = 'status-connecting';
  pulseLeapReconnect();
  setTimeout(() => {
    if (!leapSocketConnected) {
      leapStatus.textContent =
        'Still no connection — open the terminal: you should see [leap-bridge] Starting. ' +
        'Otherwise run npm run setup-leap-bridge, then npm run dev.';
      leapStatus.className = 'status-error';
    }
  }, 12000);
}

function initLeap() {
  const Leap = typeof window !== 'undefined' ? window.Leap : null;
  if (!Leap) {
    leapStatus.textContent = 'Leap library not loaded — press F to finish';
    leapStatus.className = 'status-error';
    return;
  }

  leapStatus.addEventListener('click', onLeapRetryClick);

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
    leapSocketConnected = true;
    leapReconnectAttempt = 0;
    clearLeapReconnectTimers();
    if (leapStartupTimeoutId) {
      clearTimeout(leapStartupTimeoutId);
      leapStartupTimeoutId = null;
    }
    leapStatus.textContent = 'Leap Motion: Connected — move your hands';
    leapStatus.className = 'status-waiting';
  });
  leapController.on('disconnect', () => {
    leapSocketConnected = false;
    leapConnected = false;
    lastHandData = [];
    lastAllTips = [];
    rawFrameHands = [];
    palmVelocityMag *= 0.92;
    clearLeapReconnectTimers();
    scheduleNextLeapReconnect();
  });

  leapStatus.textContent = 'Leap Motion: Connecting…';
  leapStatus.className = 'status-connecting';

  /* Always show help if the WebSocket never opened — even when disconnect/reconnect already ran (otherwise the UI stayed stuck without the Retry link). */
  leapStartupTimeoutId = setTimeout(() => {
    leapStartupTimeoutId = null;
    if (!leapSocketConnected) {
      wireLeapRetryLink();
    }
  }, 6000);

  window.addEventListener('online', () => {
    if (leapController && !leapSocketConnected) {
      leapReconnectAttempt = 0;
      clearLeapReconnectTimers();
      pulseLeapReconnect();
    }
  });
}

// ── Gesture Processing ──────────────────────────────────────────

/** Pick fact + quote for gallery save (no studio UI). */
function initStudioSessionMeta() {
  sessionCuratorialFact = pickCuratorialFact();
  sessionPotQuote = pickPotQuote();
}

function processGestures(dt) {
  const now = performance.now() * 0.001;

  if (isFinishing) {
    fistHoldTime = 0;
    return {
      sculptingEnabled: true,
      allTipsLocal: [],
      wallPullers: [],
      smoothPalms: [],
      resetSculpt: false,
      radiusScale: 1.0,
      heightScale: heightTarget,
      wheelSpeed: 0,
      stabilizing: false,
      palmStationary: false,
    };
  }

  const hasHands = lastHandData.length > 0;
  const pts = particleSys.points;

  const sculptingEnabled = true;

  const allTipsLocal = lastAllTips.map((p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z);
    pts.worldToLocal(v);
    return { x: v.x, y: v.y, z: v.z };
  });

  const wallPullers = [];
  const smoothPalms = [];
  let resetSculpt = pendingCylinderReset;
  pendingCylinderReset = false;

  let fistDetected = false;
  let radiusScale = 1.0;

  for (const hd of lastHandData) {
    if (!hd.palm) continue;

    const palmLocal = new THREE.Vector3(hd.palm.x, hd.palm.y, hd.palm.z);
    pts.worldToLocal(palmLocal);

    // Fist → photo (grabStrength > 0.8)
    if (hd.grabStrength > 0.8) {
      fistDetected = true;
      continue;
    }

    // Pinch → pressure-sculpt (depth maps vertical ring; pinch strength = rate)
    if (
      sculptingEnabled &&
      hd.pinchStrength > PINCH_CARVE_MIN &&
      hd.indexTip
    ) {
      const clayY = mapHandDepthToClayColumn(hd.indexTip.z, heightTarget);
      const v = new THREE.Vector3(hd.indexTip.x, hd.indexTip.y, hd.indexTip.z);
      pts.worldToLocal(v);
      const pinch01 = Math.max(0, Math.min(1, hd.pinchStrength || 0));
      wallPullers.push({ tip: { x: v.x, y: clayY, z: v.z }, pinch01 });
      continue;
    }

    // Flat palm → smooth profile near depth-mapped height
    if (sculptingEnabled && hd.grabStrength < 0.2 && hd.pinchStrength < 0.3) {
      const clayY = mapHandDepthToClayColumn(hd.palm.z, heightTarget);
      smoothPalms.push({
        palm: { x: palmLocal.x, y: palmLocal.y, z: palmLocal.z },
        clayY,
      });
    }
  }

  // Fist hold timer → trigger photo after 1s (requires re-open after previous finish)
  if (!fistArmed) {
    const allOpen =
      lastHandData.length === 0 ||
      lastHandData.every((h) => (h.grabStrength ?? 0) < FIST_REARM_GRAB_BELOW);
    if (allOpen) fistArmed = true;
  }

  if (fistDetected && fistArmed) {
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

  const stabilizing = wallPullers.length > 0 || smoothPalms.length > 0;
  const palmStationary = hasHands && palmVelocityMag < 95;

  return {
    sculptingEnabled,
    allTipsLocal,
    wallPullers,
    smoothPalms,
    resetSculpt,
    radiusScale,
    heightScale: heightTarget,
    wheelSpeed: lastWheelSpeed,
    stabilizing,
    palmStationary,
  };
}

// ── Finish → Save to Gallery ─────────────────────────────────────

let capturedClayDataUrl = null;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function triggerFinish() {
  if (isFinishing) return;
  isFinishing = true;
  fistArmed = false;

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
  saveStatus.textContent = '';

  try {
    const publicUrl = await uploadPostcardImage(capturedClayDataUrl, name);

    const positions = particleSys.getParticlePositions();
    const pot_shape_hint = computePotShapeHint(positions);
    const curatorial_fact = sessionCuratorialFact
      ? sessionCuratorialFact
      : pickCuratorialFactForShape(pot_shape_hint, `${name}_${Date.now()}`);
    const pot_quote = sessionPotQuote || pickPotQuote();
    const pot_color_hex = particleSys.getColorHex();
    await saveToGallery({
      user_name: name,
      user_email: '',
      postcard_image_url: publicUrl,
      clay_model_data: {
        positions,
        pot_shape_hint,
        curatorial_fact,
        pot_quote,
        pot_color_hex,
      },
    });

    notifyGalleryListUpdated();

    saveStatus.textContent = 'Saved';
    await wait(1100);

    returnToSculpting({ morph: true });

    window.setTimeout(() => {
      sessionCuratorialFact = null;
      sessionPotQuote = null;
      initStudioSessionMeta();
      applyNextColor();
    }, POST_SAVE_CYLINDER_TRANSITION_SEC * 1000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : (err?.text || JSON.stringify(err));
    saveStatus.textContent = 'Failed: ' + msg;
    btn.disabled = false;
  }
}

/**
 * Clear all transient gesture/save state so the next pot starts clean.
 * `morph: true` eases the current shape back to the default cylinder;
 * `morph: false` (Make Another button) does an instant hard reset.
 */
function returnToSculpting({ morph }) {
  saveOverlay.classList.add('hidden');
  particleSys.unfreeze();
  isFinishing = false;
  capturedClayDataUrl = null;
  document.getElementById('potter-name').value = '';
  document.getElementById('save-btn').disabled = false;

  heightTarget = 1.0;
  memorizedRadius = 1.0;
  twoHandsActive = false;
  twoHandsLostTime = 0;

  lastHandData = [];
  lastAllTips = [];
  rawFrameHands = [];
  palmVelocityMag = 0;
  lastDisplacementMag = 0;
  lastMaxPinch = 0;
  pinchCooldown = 0;
  fistHoldTime = 0;
  fistArmed = false;

  if (morph) {
    pendingCylinderReset = false;
    particleSys.beginPostSaveCylinderMorph(POST_SAVE_CYLINDER_TRANSITION_SEC);
  } else {
    particleSys.cancelPostSaveCylinderMorph();
    pendingCylinderReset = true;
  }
}

function resetForNewPot() {
  returnToSculpting({ morph: false });
  sessionCuratorialFact = null;
  sessionPotQuote = null;
  initStudioSessionMeta();
  applyNextColor();
}

// ── Animation Loop ──────────────────────────────────────────────

function animate(time = 0) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (time - lastTime) * 0.001);
  lastTime = time;

  // Pottery wheel rotation (respects dissolving damping + freeze)
  const rotSpeed = 0.008 * particleSys.getRotationDamping();
  lastWheelSpeed = rotSpeed;
  if (!particleSys.isFrozen()) {
    particleSys.points.rotation.y += rotSpeed;
  }

  const gesture = processGestures(dt);
  particleSys.update(gesture, dt);
  tickColorTween(dt);

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

  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') triggerFinish();
    if (e.key === 'r' || e.key === 'R') {
      particleSys.cancelPostSaveCylinderMorph();
      pendingCylinderReset = true;
    }
  });

  saveForm?.addEventListener('submit', handleSave);
  btnNewPot?.addEventListener('click', resetForNewPot);
  btnViewGallery?.addEventListener('click', () => {
    window.open(`/gallery.html`, GALLERY_WINDOW_NAME, 'noopener,noreferrer');
  });

  initTrackingView(camera);
  initStudioSessionMeta();
  initColorImmediate();
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
