/**
 * Capture utilities — webcam + clay snapshot + html2canvas composite.
 */

import html2canvas from 'html2canvas';

/** Capture webcam frame */
export async function captureWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: 480, height: 480 },
    audio: false,
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  await new Promise((r) => setTimeout(r, 100));

  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  stream.getTracks().forEach((t) => t.stop());

  return canvas.toDataURL('image/png');
}

/** Capture Three.js canvas as data URL */
export function captureClayCanvas(canvasEl) {
  return canvasEl.toDataURL('image/png');
}

/** Capture a DOM element as an image data URL */
export async function capturePostcardAsImage(el) {
  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#1a1918',
    scale: 2,
  });
  return canvas.toDataURL('image/png');
}
