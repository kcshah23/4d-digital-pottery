/**
 * Postcard: webcam + clay snapshot, form, html2canvas, EmailJS.
 */

import html2canvas from 'html2canvas';
import emailjs from '@emailjs/browser';

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

/** Capture postcard DOM as image */
export async function capturePostcardAsImage(postcardEl) {
  const canvas = await html2canvas(postcardEl, {
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#1a1918',
    scale: 2,
  });
  return canvas.toDataURL('image/png');
}

/**
 * Send postcard via EmailJS.
 * Requires: publicKey, serviceId, templateId in config.
 */
export async function sendPostcardEmail(config, templateParams) {
  const { publicKey, serviceId, templateId } = config;
  if (!publicKey || !serviceId || !templateId) {
    throw new Error('EmailJS config missing: set publicKey, serviceId, templateId');
  }
  await emailjs.init(publicKey);
  const res = await emailjs.send(serviceId, templateId, templateParams);
  return res;
}
