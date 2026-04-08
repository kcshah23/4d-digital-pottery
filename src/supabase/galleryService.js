/**
 * Gallery service — storage upload + CRUD for `user_postcard_gallery` in Supabase.
 */

import { getSupabaseClient } from './supabaseClient.js';

const TABLE  = 'user_postcard_gallery';
const BUCKET = 'postcard-images';

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bin  = atob(b64);
  const arr  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 40) || 'anon';
}

/**
 * Upload postcard PNG to the `postcard-images` storage bucket.
 *
 * @param {string} dataUrl  – base64 data-URL (canvas capture)
 * @param {string} name     – potter name (used in the file path)
 * @returns {Promise<string>} public URL of the uploaded image
 */
export async function uploadPostcardImage(dataUrl, name) {
  const sb   = getSupabaseClient();
  const blob = dataUrlToBlob(dataUrl);
  const path = `${sanitizeName(name)}_${Date.now()}.png`;

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/png', upsert: false });

  if (uploadErr) throw new Error(`Image upload failed: ${uploadErr.message}`);

  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Save a finished postcard + clay model to the gallery.
 *
 * @param {Object} entry
 * @param {string} entry.user_name
 * @param {string} entry.user_email
 * @param {string} entry.postcard_image_url  – public URL from storage upload
 * @param {Object} entry.clay_model_data     – { positions, pot_shape_hint?, curatorial_fact?, pot_quote?, pot_color_hex? }
 * @returns {Promise<Object>} the inserted row
 */
export async function saveToGallery({ user_name, user_email, postcard_image_url, clay_model_data }) {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from(TABLE)
    .insert([{ user_name, user_email, postcard_image_url, clay_model_data }])
    .select()
    .single();

  if (error) throw new Error(`Gallery save failed: ${error.message}`);
  return data;
}

/**
 * Fetch gallery rows for the grid (image + metadata only).
 * Uses RPC `gallery_list_rows` so Postgres never ships 50k particle positions per row
 * (that caused statement timeouts on SELECT *).
 *
 * If the RPC is missing, falls back to a slim column select (no facts/quotes until you run
 * `supabase/gallery_list_rows.sql` in the Supabase SQL Editor).
 *
 * @param {number} [limit=50]
 * @returns {Promise<Object[]>}
 */
export async function fetchGallery(limit = 50) {
  const sb = getSupabaseClient();
  const rowLimit = Math.min(500, Math.max(1, limit));

  const rpc = await sb.rpc('gallery_list_rows', { row_limit: rowLimit });

  if (!rpc.error && rpc.data) return rpc.data;

  const missingFn =
    rpc.error &&
    (/function public\.gallery_list_rows/i.test(rpc.error.message || '') ||
      /does not exist/i.test(rpc.error.message || '') ||
      rpc.error.code === '42883');

  if (!missingFn && rpc.error) {
    throw new Error(`Gallery fetch failed: ${rpc.error.message}`);
  }

  const { data, error } = await sb
    .from(TABLE)
    .select('id, created_at, user_name, user_email, postcard_image_url')
    .order('created_at', { ascending: false })
    .limit(rowLimit);

  if (error) throw new Error(`Gallery fetch failed: ${error.message}`);

  return (data || []).map((row) => ({
    ...row,
    clay_model_data: {},
  }));
}

/**
 * Fetch a single gallery entry by id (includes clay_model_data for 3D re-rendering).
 *
 * @param {string} id  – UUID
 * @returns {Promise<Object>}
 */
export async function fetchGalleryEntry(id) {
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(`Gallery entry fetch failed: ${error.message}`);
  return data;
}
