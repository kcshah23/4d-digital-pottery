/**
 * Supabase client — uses the CDN-loaded global `supabase` object.
 *
 * Replace the placeholder URL and anon key with your project's values
 * from: Supabase Dashboard → Settings → API.
 */

const SUPABASE_URL  = 'https://omohaodcvpwibrnokjyz.supabase.co';
const SUPABASE_ANON = 'sb_publishable_d_8N8j2_gvcXy2lWBY9xdA_iHpxowxb';

let client = null;

export function getSupabaseClient() {
  if (client) return client;

  const { createClient } = window.supabase;
  if (!createClient) {
    throw new Error('Supabase CDN not loaded — check the <script> tag in index.html');
  }

  client = createClient(SUPABASE_URL, SUPABASE_ANON);
  return client;
}
