/**
 * Gallery page — fetches all pots from Supabase and renders a grid.
 */

import { fetchGallery } from './supabase/galleryService.js';

const grid    = document.getElementById('gallery-grid');
const empty   = document.getElementById('gallery-empty');
const loading = document.getElementById('gallery-loading');

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

      const img = document.createElement('img');
      img.src = entry.postcard_image_url;
      img.alt = `Pot by ${entry.user_name}`;
      img.loading = 'lazy';

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
      card.appendChild(img);
      card.appendChild(info);
      grid.appendChild(card);
    }
  } catch (err) {
    loading.classList.add('hidden');
    empty.textContent = 'Could not load gallery — check Supabase connection.';
    empty.classList.remove('hidden');
  }
}

loadGallery();
