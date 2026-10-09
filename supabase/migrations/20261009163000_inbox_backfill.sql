-- Re-read older mail with the third eye, a small window per tick, without filing anything twice:
-- emails already triaged or already logged are skipped, and a person already on file by email,
-- Indeed address, phone or (when exactly one matches) full name is reused instead of added again.
alter table public.google_accounts add column if not exists backfill_from timestamptz;
alter table public.google_accounts add column if not exists backfill_to timestamptz;

create or replace function public.gmail_backfill_get(p_secret text, p_staff uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select jsonb_build_object('from', g.backfill_from, 'to', g.backfill_to)
            from public.google_accounts g where g.staff_id = p_staff and g.backfill_from is not null and g.backfill_to is not null);
end $$;

-- Moves the window forward; finished once it reaches where the backfill was asked to stop.
create or replace function public.gmail_backfill_set(p_secret text, p_staff uuid, p_from timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.google_accounts g
     set backfill_from = case when p_from >= g.backfill_to then null else p_from end,
         backfill_to = case when p_from >= g.backfill_to then null else g.backfill_to end
   where g.staff_id = p_staff;
end $$;

revoke all on function public.gmail_backfill_get(text, uuid) from public, anon, authenticated;
revoke all on function public.gmail_backfill_set(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.gmail_backfill_get(text, uuid) to anon, authenticated;
grant execute on function public.gmail_backfill_set(text, uuid, timestamptz) to anon, authenticated;

-- inbox_file: before adding a new person, reuse the one candidate with exactly that full name.
do $$
declare def text;
begin
  select pg_get_functiondef('public.inbox_file(text, jsonb)'::regprocedure) into def;
  if position('  if cand is null and kind = ''not_interested'' then return null; end if;' in def) = 0 then
    raise exception 'inbox_file pattern not found';
  end if;
  def := replace(def, '  if cand is null and kind = ''not_interested'' then return null; end if;',
'  if cand is null and nullif(trim(p->>''name''), '''') is not null then
    select min(c.id::text)::uuid into cand from public.candidates c
     where lower(trim(c.full_name)) = lower(trim(p->>''name'')) having count(*) = 1;
  end if;
  if cand is null and kind = ''not_interested'' then return null; end if;');
  execute def;
end $$;
