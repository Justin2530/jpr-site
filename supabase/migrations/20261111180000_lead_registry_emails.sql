-- Emails found on each researched business's own website (Justin, 2026-11-11).
alter table public.lead_registry add column if not exists email text, add column if not exists emails text[];
do $$ declare d text; begin
  d := pg_get_functiondef('public.lead_registry_save(text, text, jsonb)'::regprocedure);
  d := replace(d, $x$size_guess = p_data->>'size_guess',$x$, $x$size_guess = p_data->>'size_guess', email = p_data->>'email',
    emails = (select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'emails', '[]'::jsonb)) x),$x$);
  if position('emails =' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $$;
