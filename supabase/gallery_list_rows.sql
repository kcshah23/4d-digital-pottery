-- Run once in Supabase → SQL Editor.
-- Fixes gallery timeouts: listing used SELECT * and pulled ~150k floats per row in clay_model_data.
-- This function returns only card fields + light JSON (facts, quotes, color), not positions.

create or replace function public.gallery_list_rows(row_limit int default 100)
returns table (
  id uuid,
  created_at timestamptz,
  user_name text,
  user_email text,
  postcard_image_url text,
  clay_model_data jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    g.id,
    g.created_at,
    g.user_name,
    g.user_email,
    g.postcard_image_url,
    jsonb_strip_nulls(
      jsonb_build_object(
        'curatorial_fact', g.clay_model_data->'curatorial_fact',
        'pot_quote', g.clay_model_data->'pot_quote',
        'pot_color_hex', g.clay_model_data->'pot_color_hex',
        'pot_shape_hint', g.clay_model_data->'pot_shape_hint'
      )
    )
  from public.user_postcard_gallery g
  order by g.created_at desc
  limit greatest(1, least(row_limit, 500));
$$;

grant execute on function public.gallery_list_rows(int) to anon, authenticated;
