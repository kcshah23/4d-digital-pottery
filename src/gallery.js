/**
 * Gallery page — fetches all pots from Supabase and renders a grid.
 * Ceramic fact sits above the pot image; the quote (if any) overlays it.
 *
 * Auto-refresh strategy (live second-display updates on every save):
 *   1. BroadcastChannel — same-browser tabs, instant.
 *   2. Supabase Realtime — cross-device INSERT notifications.
 *   3. Polling fallback — every 15s, compare max(created_at); cheap belt-and-braces.
 *   4. visibilitychange — refresh the moment the gallery tab is focused again.
 * All paths funnel through `refreshGallery()` which debounces + dedupes.
 */

import { fetchGallery } from './supabase/galleryService.js';
import { getSupabaseClient } from './supabase/supabaseClient.js';
import { resolveCuratorialFactForGallery } from './gallery/potteryFacts.js';
import { GALLERY_SYNC_CHANNEL } from './gallerySyncChannel.js';

const grid    = document.getElementById('gallery-grid');
const empty   = document.getElementById('gallery-empty');
const loading = document.getElementById('gallery-loading');

/** Timestamp of the newest row we've rendered; used to de-dupe polling + realtime signals. */
let latestCreatedAt = '';
/** Debounce handle so rapid-fire signals collapse into a single refetch. */
let refreshTimer = null;

/** Fact directly above the pottery image box (source intentionally omitted). */
function appendFactAboveBlock(card, cf) {
  if (!cf || typeof cf.fact !== 'string') return;

  const wrap = document.createElement('div');
  wrap.className = 'gallery-card-fact-above';

  const factEl = document.createElement('p');
  factEl.className = 'gallery-card-fact';
  factEl.textContent = cf.fact;
  factEl.title = cf.fact;
  wrap.appendChild(factEl);

  card.appendChild(wrap);
}

/** Quote overlaid on the pot image. Author is intentionally omitted. */
function appendQuoteOverlay(visual, pq) {
  if (!pq || typeof pq.text !== 'string') return;

  const overlay = document.createElement('div');
  overlay.className = 'gallery-card-quote-overlay';

  const bq = document.createElement('blockquote');
  bq.className = 'gallery-card-quote gallery-card-quote--overlay';
  const p = document.createElement('p');
  p.textContent = `“${pq.text}”`;
  bq.appendChild(p);
  overlay.appendChild(bq);

  visual.appendChild(overlay);
}

/** "Apr 21, 2026 · 4:09 PM" — locale-friendly date + time for the card footer. */
function formatSavedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * @param {{ quiet?: boolean }} opts — quiet: no loading row (for live refresh from studio).
 */
async function loadGallery(opts = {}) {
  const quiet = opts.quiet === true;
  try {
    if (!quiet) {
      loading.classList.remove('hidden');
    }
    const entries = await fetchGallery(200);

    if (!quiet) {
      loading.classList.add('hidden');
    }

    grid.innerHTML = '';

    if (!entries || entries.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    latestCreatedAt = entries[0]?.created_at || latestCreatedAt;

    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const clay = entry.clay_model_data;

      const cf = resolveCuratorialFactForGallery(clay && clay.curatorial_fact, entry.id, clay);
      appendFactAboveBlock(card, cf);

      const visual = document.createElement('div');
      visual.className = 'gallery-card-visual';

      const img = document.createElement('img');
      img.src = entry.postcard_image_url;
      img.alt = `Pot by ${entry.user_name}`;
      img.loading = 'lazy';
      visual.appendChild(img);

      const pq = clay && clay.pot_quote;
      appendQuoteOverlay(visual, pq);

      const info = document.createElement('div');
      info.className = 'gallery-info';

      const name = document.createElement('span');
      name.className = 'gallery-name';
      name.textContent = entry.user_name;
      info.appendChild(name);

      const stamp = formatSavedAt(entry.created_at);
      if (stamp) {
        const when = document.createElement('span');
        when.className = 'gallery-stamp';
        when.textContent = stamp;
        info.appendChild(when);
      }

      card.appendChild(visual);
      card.appendChild(info);

      grid.appendChild(card);
    }
  } catch (err) {
    loading.classList.add('hidden');
    if (quiet) {
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    empty.innerHTML = '';
    empty.append(
      document.createTextNode(
        'Could not load the gallery. Check URL/key in src/supabase/supabaseClient.js and RLS (anon SELECT on user_postcard_gallery). If the error mentions timeout, run supabase/gallery_list_rows.sql in the Supabase SQL Editor. ',
      ),
    );
    const mono = document.createElement('span');
    mono.className = 'gallery-error-detail';
    mono.textContent = detail;
    empty.appendChild(mono);
    empty.classList.remove('hidden');
  }
}

/** Debounced quiet refetch. Multiple signals within 400ms collapse into one. */
function refreshGallery() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    loadGallery({ quiet: true });
  }, 400);
}

// ── 1. BroadcastChannel (same-browser tabs) ──────────────────────────────
try {
  const sync = new BroadcastChannel(GALLERY_SYNC_CHANNEL);
  sync.onmessage = (ev) => {
    if (ev?.data?.type === 'refresh') {
      console.info('[gallery] broadcast received → refresh');
      refreshGallery();
    }
  };
  console.info('[gallery] broadcast listener ready');
} catch (_) {
  console.warn('[gallery] BroadcastChannel unsupported');
}

// ── 2. Supabase Realtime (cross-device; requires Realtime enabled on table) ──
try {
  const sb = getSupabaseClient();
  sb.channel('gallery-inserts')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'user_postcard_gallery' },
      () => {
        console.info('[gallery] realtime INSERT → refresh');
        refreshGallery();
      },
    )
    .subscribe((status) => {
      console.info('[gallery] realtime status:', status);
    });
} catch (e) {
  console.warn('[gallery] Realtime unavailable', e);
}

// ── 3. Polling fallback (every 4s for near-instant cross-device updates) ──
async function pollForNewPots() {
  try {
    const latest = await fetchGallery(1);
    const top = latest && latest[0];
    if (top && top.created_at && top.created_at !== latestCreatedAt) {
      console.info('[gallery] poll detected new pot → refresh', top.created_at);
      refreshGallery();
    }
  } catch (_) {
    /* transient network error; try again next tick */
  }
}
setInterval(pollForNewPots, 4000);

// ── 4. Tab focus ─────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pollForNewPots();
});

loadGallery();
