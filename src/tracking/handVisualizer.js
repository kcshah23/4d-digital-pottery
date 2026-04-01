/**
 * Live hand skeleton / IR visualizer drawn on a 2D canvas.
 * Receives raw LeapJS hand objects each frame.
 */

const W = 280;
const H = 200;

let ctx = null;
let mode = 'skeleton';

// Leap mm → canvas pixels (front-facing X-Y projection)
function toCanvas(pos) {
  const x = (pos[0] / 350 + 0.5) * W;
  const y = (1 - (pos[1] - 30) / 350) * H;
  return [x, y];
}

function line(a, b, color, width) {
  const [ax, ay] = toCanvas(a);
  const [bx, by] = toCanvas(b);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function dot(pos, r, color) {
  const [x, y] = toCanvas(pos);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function glow(pos, r, color) {
  const [x, y] = toCanvas(pos);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ── Skeleton mode ───────────────────────────────────────────────

function drawSkeleton(hands) {
  for (const hand of hands) {
    if (hand.palmPosition) {
      dot(hand.palmPosition, 5, 'rgba(255,255,255,0.35)');
    }

    if (!hand.fingers) continue;

    for (const finger of hand.fingers) {
      if (finger.bones && finger.bones.length > 0) {
        for (const bone of finger.bones) {
          const prev = bone.prevJoint;
          const next = bone.nextJoint;
          if (prev && next) {
            line(prev, next, 'rgba(255,255,255,0.5)', 1.5);
            dot(next, 2, 'rgba(255,255,255,0.75)');
          }
        }
        if (hand.palmPosition && finger.bones[0]?.prevJoint) {
          line(hand.palmPosition, finger.bones[0].prevJoint, 'rgba(255,255,255,0.18)', 1);
        }
      } else if (finger.tipPosition && hand.palmPosition) {
        line(hand.palmPosition, finger.tipPosition, 'rgba(255,255,255,0.3)', 1);
        dot(finger.tipPosition, 2.5, 'rgba(255,255,255,0.7)');
      }
    }
  }
}

// ── IR mode ─────────────────────────────────────────────────────

function drawIR(hands) {
  for (const hand of hands) {
    if (hand.palmPosition) {
      glow(hand.palmPosition, 35, 'rgba(120,255,160,0.25)');
    }

    if (!hand.fingers) continue;

    for (const finger of hand.fingers) {
      if (finger.bones && finger.bones.length > 0) {
        for (const bone of finger.bones) {
          const prev = bone.prevJoint;
          const next = bone.nextJoint;
          if (next) glow(next, 10, 'rgba(120,255,160,0.35)');
          if (prev && next) {
            const [ax, ay] = toCanvas(prev);
            const [bx, by] = toCanvas(next);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = 'rgba(120,255,160,0.2)';
            ctx.lineWidth = 6;
            ctx.stroke();
            ctx.strokeStyle = 'rgba(180,255,200,0.45)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      } else if (finger.tipPosition) {
        glow(finger.tipPosition, 14, 'rgba(120,255,160,0.45)');
      }
    }
  }
}

// ── Public API ──────────────────────────────────────────────────

export function initTrackingView() {
  const canvasEl = document.getElementById('tracking-canvas');
  if (!canvasEl) return;
  ctx = canvasEl.getContext('2d');

  const btn = document.getElementById('tracking-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      mode = mode === 'skeleton' ? 'ir' : 'skeleton';
      btn.textContent = mode === 'skeleton' ? 'SKEL' : 'IR';
    });
  }
}

export function updateTrackingView(hands) {
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);

  // Reference line at typical palm height (~200mm)
  const refY = (1 - (200 - 30) / 350) * H;
  ctx.beginPath();
  ctx.moveTo(0, refY);
  ctx.lineTo(W, refY);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!hands || hands.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NO HANDS DETECTED', W / 2, H / 2);
    return;
  }

  if (mode === 'skeleton') drawSkeleton(hands);
  else drawIR(hands);
}
