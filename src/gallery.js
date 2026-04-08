/**
 * Gallery page — fetches all pots from Supabase and renders a grid.
 * Each pot shows a ceramic-history fact (saved with the row, or stable fallback from potteryFacts)
 * and a quote when available.
 */

import { fetchGallery } from './supabase/galleryService.js';
import { resolveCuratorialFactForGallery } from './gallery/potteryFacts.js';

const grid    = document.getElementById('gallery-grid');
const empty   = document.getElementById('gallery-empty');
const loading = document.getElementById('gallery-loading');

function appendCuratorialBlock(card, cf) {
  if (!cf || typeof cf.fact !== 'string') return;

  const factEl = document.createElement('p');
  factEl.className = 'gallery-card-fact';
  factEl.textContent = cf.fact;
  factEl.title = cf.fact;
  card.appendChild(factEl);

  const srcEl = document.createElement('p');
  srcEl.className = 'gallery-card-source';

  if (typeof cf.source === 'string' && typeof cf.url === 'string' && cf.url) {
    srcEl.append('Source: ');
    const a = document.createElement('a');
    a.href = cf.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = cf.source;
    srcEl.append(a);
  } else if (typeof cf.source === 'string') {
    srcEl.textContent = `Source: ${cf.source}`;
  }

  card.appendChild(srcEl);
}

function appendQuoteBlock(card, q) {
  if (!q || typeof q.text !== 'string') return;

  const bq = document.createElement('blockquote');
  bq.className = 'gallery-card-quote';
  const p = document.createElement('p');
  p.textContent = `“${q.text}”`;
  bq.appendChild(p);

  if (typeof q.author === 'string' && q.author) {
    const cite = document.createElement('cite');
    cite.textContent = q.author;
    bq.appendChild(cite);
  }

  card.appendChild(bq);
}

async function loadGallery() {
  try {
    const entries = await fetchGallery(200);
    loading.classList.add('hidden');

    if (!entries || entries.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'gallery-card';

      const visual = document.createElement('div');
      visual.className = 'gallery-card-visual';

      const img = document.createElement('img');
      img.src = entry.postcard_image_url;
      img.alt = `Pot by ${entry.user_name}`;
      img.loading = 'lazy';
      visual.appendChild(img);

      const info = document.createElement('div');
      info.className = 'gallery-info';

      const name = document.createElement('span');
      name.className = 'gallery-name';
      name.textContent = entry.user_name;

      const date = document.createElement('span');
      date.className = 'gallery-date';
      date.textContent = new Date(entry.created_at).toLocaleDateString();

      info.appendChild(name);
      info.appendChild(date);

      card.appendChild(visual);
      card.appendChild(info);

      const clay = entry.clay_model_data;
      const cf = resolveCuratorialFactForGallery(clay && clay.curatorial_fact, entry.id, clay);
      appendCuratorialBlock(card, cf);

      const pq = clay && clay.pot_quote;
      appendQuoteBlock(card, pq);

      grid.appendChild(card);
    }
  } catch (err) {
    loading.classList.add('hidden');
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

loadGallery();
