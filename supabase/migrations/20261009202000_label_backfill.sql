-- Labeling older mail (Justin 2026-10-09: "go back to the beginning of september"). Separate from the filing
-- backfill: this one only puts Gmail labels on candidate and client threads; nothing is added, logged or
-- answered in the Command Center.
create table if not exists public.label_backfill (
  staff_id uuid primary key references public.staff(id),
  from_at timestamptz,
  to_at timestamptz
);
alter table public.label_backfill enable row level security;

create or replace function public.label_backfill_get(p_secret text, p_staff uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select jsonb_build_object('from', b.from_at, 'to', b.to_at)
            from public.label_backfill b where b.staff_id = p_staff and b.from_at is not null and b.to_at is not null);
end $$;

create or replace function public.label_backfill_set(p_secret text, p_staff uuid, p_from timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.label_backfill b
     set from_at = case when p_from >= b.to_at - interval '1 second' then null else p_from end,
         to_at = case when p_from >= b.to_at - interval '1 second' then null else b.to_at end
   where b.staff_id = p_staff;
end $$;

-- Which of these Gmail ids already have a label row (so a re-read never labels twice).
create or replace function public.inbox_label_known(p_secret text, p_ids text[])
returns setof text language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query select l.gmail_id from public.inbox_labels l where l.gmail_id = any(p_ids);
end $$;

revoke all on function public.label_backfill_get(text, uuid), public.label_backfill_set(text, uuid, timestamptz), public.inbox_label_known(text, text[]) from public;
grant execute on function public.label_backfill_get(text, uuid), public.label_backfill_set(text, uuid, timestamptz), public.inbox_label_known(text, text[]) to anon, authenticated;

-- Start: Sept 1 (Eastern) up to when labels went live (the watcher labels everything after that).
insert into public.label_backfill (staff_id, from_at, to_at)
select g.staff_id, timestamptz '2026-09-01 00:00 America/New_York', timestamptz '2026-10-09 17:05+00'
  from public.google_accounts g
on conflict (staff_id) do nothing;
