/**
 * Same-origin tabs only: studio notifies gallery to refetch after a save.
 * Use this window name on the Gallery link (target="…") or window.open so one gallery window is reused.
 */
export const GALLERY_WINDOW_NAME = 'pottery-gallery';

export const GALLERY_SYNC_CHANNEL = '4d-digital-pottery-gallery-sync';

export function notifyGalleryListUpdated() {
  try {
    const ch = new BroadcastChannel(GALLERY_SYNC_CHANNEL);
    ch.postMessage({ type: 'refresh' });
    ch.close();
  } catch (_) {
    /* BroadcastChannel unsupported */
  }
}
