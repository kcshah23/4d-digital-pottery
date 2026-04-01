/**
 * Nature Audio — flowing stream, forest wind, water droplets, bird chirps.
 * Pure Web Audio API synthesis, no samples required.
 */

let audioContext = null;
let squishBuffer = null;

// Flowing stream (continuous babbling water)
let streamNodes = null;
let streamMaster = null;

// Forest wind (breathy, leaf-rustle texture)
let windNode = null;

// Rain presence (soft patter that swells with hand proximity)
let rainNode = null;
let rainMaster = null;

// Timing guards
let lastDropTime = 0;
let lastChirpTime = 0;

export function initAudio() {
  if (audioContext) return audioContext;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return audioContext;
}

export async function resumeAudio() {
  const ctx = initAudio();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

// ── Flowing Stream ──────────────────────────────────────────────
// Layered bandpass-filtered noise with slow LFO on cutoff
// frequencies to create a babbling brook texture.

function createStream(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const bufLen = 2 * ctx.sampleRate;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1);
  }

  const layers = [
    { center: 400,  Q: 1.2, gain: 0.08, lfoRate: 0.13 },
    { center: 1200, Q: 2.0, gain: 0.04, lfoRate: 0.21 },
    { center: 3000, Q: 3.0, gain: 0.02, lfoRate: 0.07 },
  ];

  const nodes = layers.map(l => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = l.center;
    bp.Q.value = l.Q;

    // LFO wobbles the cutoff for organic babble
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = l.lfoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = l.center * 0.3;
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);
    lfo.start();

    const g = ctx.createGain();
    g.gain.value = l.gain;

    src.connect(bp);
    bp.connect(g);
    g.connect(master);

    return { src, bp, lfo, gain: g };
  });

  return { nodes, master };
}

export function updateRotationHum(rotationSpeed) {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  if (!streamNodes) {
    const s = createStream(ctx);
    streamNodes = s.nodes;
    streamMaster = s.master;
  }

  const vol = Math.min(0.7, rotationSpeed * 60);
  streamMaster.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.5);
}

// ── Forest Wind ─────────────────────────────────────────────────
// Pink noise through a sweeping bandpass — like wind rustling
// through leaves. Volume and brightness track palm velocity.

function createWind(ctx) {
  const bufLen = 2 * ctx.sampleRate;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufLen; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.08;
    b6 = w * 0.115926;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start(0);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 300;
  bp.Q.value = 0.4;

  // Slow sweep for organic movement
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.08;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 150;
  lfo.connect(lfoG);
  lfoG.connect(bp.frequency);
  lfo.start();

  const gain = ctx.createGain();
  gain.gain.value = 0;

  src.connect(bp);
  bp.connect(gain);
  gain.connect(ctx.destination);

  return { src, bp, gain, lfo };
}

export function updateSwoosh(palmVelocityMag) {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  if (!windNode) windNode = createWind(ctx);

  const v = Math.min(1, palmVelocityMag / 1200);
  const vol = v * 0.18;
  const center = 250 + v * 500;

  windNode.gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.2);
  windNode.bp.frequency.linearRampToValueAtTime(center, ctx.currentTime + 0.2);
}

// ── Rain Presence ───────────────────────────────────────────────
// Soft high-frequency filtered noise that sounds like gentle rain
// on a pond surface. Swells when hands are close to the pot.

function createRain(ctx) {
  const bufLen = 2 * ctx.sampleRate;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1);
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start(0);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  hp.Q.value = 0.3;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 8000;
  lp.Q.value = 0.5;

  const master = ctx.createGain();
  master.gain.value = 0;

  src.connect(hp);
  hp.connect(lp);
  lp.connect(master);
  master.connect(ctx.destination);

  return { src, master };
}

export function updateContactBuzz(hasHands, palmDistFromCenter) {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  if (!rainNode) {
    const r = createRain(ctx);
    rainNode = r;
    rainMaster = r.master;
  }

  if (hasHands) {
    const proximity = 1 - Math.min(1, palmDistFromCenter / 0.35);
    const vol = 0.02 + proximity * 0.06;
    rainMaster.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.5);
  } else {
    rainMaster.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
  }
}

// ── Water Droplets ──────────────────────────────────────────────
// Short sine pings at randomized frequencies with quick decay,
// like water dripping into a ceramic bowl. Triggered by sculpting.

export function playSquish(displacementAmount) {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  if (now - lastDropTime < 0.15) return;
  lastDropTime = now;

  const count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const delay = i * (0.04 + Math.random() * 0.06);
    const freq = 800 + Math.random() * 1400;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + delay);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + delay + 0.3);

    const g = ctx.createGain();
    const vol = Math.min(0.1, Math.max(0.02, displacementAmount * 0.6));
    g.gain.setValueAtTime(0, now + delay);
    g.gain.linearRampToValueAtTime(vol, now + delay + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 0.45);
  }
}

// ── Bird Chirp ──────────────────────────────────────────────────
// Quick upward frequency sweep — a small bird call triggered
// on pinch-strength spikes. Two-note trill a minor third apart.

export function playWaterSquish() {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  if (now - lastChirpTime < 0.4) return;
  lastChirpTime = now;

  const baseFreq = 1800 + Math.random() * 800;

  [0, 0.1].forEach((offset, i) => {
    const t = now + offset;
    const freq = i === 0 ? baseFreq : baseFreq * 1.19; // minor third up

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.85, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.9, t + 0.12);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  });
}

// ── Load external sample (kept for compatibility) ───────────────

export async function loadSquishSound(url = '/squish.mp3') {
  const ctx = initAudio();
  try {
    const res = await fetch(url);
    const ab = await res.arrayBuffer();
    squishBuffer = await ctx.decodeAudioData(ab);
  } catch {
    squishBuffer = null;
  }
}
