/**
 * Supabase client — bundled via `@supabase/supabase-js` (no CDN global).
 *
 * Set URL + anon (or publishable) key from: Supabase Dashboard → Settings → API.
 * Gallery reads require a SELECT policy on `user_postcard_gallery` for `anon`.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://omohaodcvpwibrnokjyz.supabase.co';
const SUPABASE_ANON = 'sb_publishable_d_8N8j2_gvcXy2lWBY9xdA_iHpxowxb';

let client = null;

export function getSupabaseClient() {
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_ANON);
  return client;
}
