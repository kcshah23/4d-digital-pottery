/**
 * Full-screen hand skeleton overlay.
 * Projects raw Leap hand positions through the Three.js camera
 * so the skeleton aligns with the particle cloud.
 */

import * as THREE from 'three';

const LEAP_SCALE = 0.002;
const LEAP_OFFSET_Y = -0.15;

let ctx = null;
let canvasEl = null;
let cam = null;
let accentColor = 'rgba(255,255,255,0.6)';
let accentGlow  = 'rgba(255,255,255,0.15)';

const _v = new THREE.Vector3();

function leapToScreen(pos) {
  _v.set(pos[0] * LEAP_SCALE, pos[1] * LEAP_SCALE + LEAP_OFFSET_Y, -pos[2] * LEAP_SCALE);
  _v.project(cam);
  return [
    (_v.x *  0.5 + 0.5) * canvasEl.width,
    (_v.y * -0.5 + 0.5) * canvasEl.height,
  ];
}

function line(a, b, color, width) {
  const [ax, ay] = leapToScreen(a);
  const [bx, by] = leapToScreen(b);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function dot(pos, r, color) {
  const [x, y] = leapToScreen(pos);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function glow(pos, r, color) {
  const [x, y] = leapToScreen(pos);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawHands(hands) {
  for (const hand of hands) {
    if (hand.palmPosition) {
      glow(hand.palmPosition, 40, accentGlow);
      dot(hand.palmPosition, 4, accentColor);
    }

    if (!hand.fingers) continue;

    for (const finger of hand.fingers) {
      if (finger.bones && finger.bones.length > 0) {
        for (const bone of finger.bones) {
          const prev = bone.prevJoint;
          const next = bone.nextJoint;
          if (prev && next) {
            line(prev, next, accentColor, 1.8);
            dot(next, 2.5, accentColor);
          }
        }
        if (hand.palmPosition && finger.bones[0]?.prevJoint) {
          line(hand.palmPosition, finger.bones[0].prevJoint, accentGlow, 1);
        }
      } else if (finger.tipPosition && hand.palmPosition) {
        line(hand.palmPosition, finger.tipPosition, accentColor, 1.2);
        dot(finger.tipPosition, 3, accentColor);
      }
    }
  }
}

function resize() {
  if (!canvasEl) return;
  canvasEl.width  = window.innerWidth;
  canvasEl.height = window.innerHeight;
}

// ── Public API ──────────────────────────────────────────────────

export function initTrackingView(camera) {
  canvasEl = document.getElementById('tracking-canvas');
  if (!canvasEl) return;
  ctx = canvasEl.getContext('2d');
  cam = camera;
  resize();
  window.addEventListener('resize', resize);
}

export function updateTrackingView(hands) {
  if (!ctx || !cam) return;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!hands || hands.length === 0) return;
  drawHands(hands);
}

export function setTrackingColor(hexColor) {
  const r = (hexColor >> 16) & 255;
  const g = (hexColor >> 8)  & 255;
  const b =  hexColor & 255;
  accentColor = `rgba(${r},${g},${b},0.6)`;
  accentGlow  = `rgba(${r},${g},${b},0.18)`;
}
