/**
 * Same-origin tabs only: studio notifies gallery to refetch after a save.
 * Use this window name on the Gallery link (target="…") or window.open so one gallery window is reused.
 */
export const GALLERY_WINDOW_NAME = 'pottery-gallery';

export const GALLERY_SYNC_CHANNEL = '4d-digital-pottery-gallery-sync';

/**
 * Reuse a single BroadcastChannel so the channel isn't torn down before
 * other tabs receive the message (closing immediately after postMessage
 * can race with delivery in some browsers).
 */
let _ch = null;
function getChannel() {
  if (_ch) return _ch;
  try {
    _ch = new BroadcastChannel(GALLERY_SYNC_CHANNEL);
  } catch (_) {
    _ch = null;
  }
  return _ch;
}

export function notifyGalleryListUpdated() {
  const ch = getChannel();
  if (!ch) {
    console.warn('[gallery-sync] BroadcastChannel unsupported in this browser');
    return;
  }
  try {
    ch.postMessage({ type: 'refresh', at: Date.now() });
    console.info('[gallery-sync] broadcast sent');
  } catch (e) {
    console.warn('[gallery-sync] broadcast failed', e);
  }
}
