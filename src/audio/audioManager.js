/**
 * 4D Audio: swoosh (velocity) + squish (deformation).
 * Uses raw Web Audio API for lightweight, dependency-free sound.
 */

let audioContext = null;
let swooshNode = null;
let squishBuffer = null;
let squishGain = null;

/** Initialize audio (must be triggered by user interaction for autoplay policy) */
export function initAudio() {
  if (audioContext) return audioContext;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return audioContext;
}

/** Resume if suspended (e.g. after user click) */
export async function resumeAudio() {
  const ctx = initAudio();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

/** Create swoosh noise (low-pass filtered wind) */
function createSwooshNode(ctx) {
  const bufferSize = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start(0);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  filter.Q.value = 1;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  return { source, filter, gain };
}

/** Update swoosh based on palm velocity (magnitude) */
export function updateSwoosh(palmVelocityMag) {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  if (!swooshNode) {
    swooshNode = createSwooshNode(ctx);
  }

  const { filter, gain } = swooshNode;
  const v = Math.min(1, palmVelocityMag / 1500);
  const vol = v * 0.25;
  const pitch = 200 + v * 600;

  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.05);
  filter.frequency.linearRampToValueAtTime(pitch, ctx.currentTime + 0.05);
}

/** Load squish sound and play with volume based on displacement */
export async function loadSquishSound(url = '/squish.mp3') {
  const ctx = initAudio();
  try {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    squishBuffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn('Squish sound not found at', url, '- using silent fallback');
    squishBuffer = null;
  }
}

/** Play squish with gain 0–1 based on deformation amount */
export function playSquish(displacementAmount) {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  if (!squishBuffer) return;

  const source = ctx.createBufferSource();
  source.buffer = squishBuffer;
  const gain = ctx.createGain();
  gain.gain.value = Math.min(1, Math.max(0.1, displacementAmount * 2));
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(0);
}
