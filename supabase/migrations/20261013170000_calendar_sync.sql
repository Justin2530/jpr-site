-- The Command Center calendar (Justin 2026-10-13: "keeps track of everything ... and pushes to my google calendar").
-- calendar_feed lists every dated thing JPR tracks; calendar_links remembers which Google event each one became.

create table if not exists public.calendar_links (
  source_key text primary key,
  staff_id uuid not null references public.staff(id),
  google_event_id text not null,
  fingerprint text not null,
  removed boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.calendar_links enable row level security;

-- Everything with a date, from yesterday on: client interviews, AI screening calls, open tasks and reminders with a
-- due date, and sales next steps. Shared by the calendar page (as staff) and the Google push (with the secret).
create or replace function public.calendar_events(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(e order by e->>'start'), '[]'::jsonb) from (
    select jsonb_build_object('key', 'iv:' || i.id, 'kind', 'interview',
             'title', 'Interview: ' || c.full_name || ' · ' || coalesce(co.name, ''),
             'start', i.scheduled_at, 'minutes', 30,
             'detail', concat_ws(' · ', j.title, nullif(i.details, '')),
             'href', '/candidates/' || c.id || '?job=' || cj.id, 'done', i.scheduled_at < now()) e
      from public.interviews i join public.candidate_jobs cj on cj.id = i.candidate_job_id
      join public.candidates c on c.id = cj.candidate_id join public.jobs j on j.id = cj.job_id
      left join public.companies co on co.id = j.company_id
     where i.status in ('confirmed', 'done') and i.scheduled_at between p_from and p_to
       and public.can_access_market(j.market_id)
    union all
    select jsonb_build_object('key', 'sc:' || r.id, 'kind', 'screening',
             'title', 'AI screening call: ' || c.full_name,
             'start', r.scheduled_for, 'minutes', 15, 'detail', j.title,
             'href', '/candidates/' || c.id || '?job=' || cj.id, 'done', r.status <> 'scheduled')
      from public.screening_runs r join public.candidate_jobs cj on cj.id = r.candidate_job_id
      join public.candidates c on c.id = cj.candidate_id join public.jobs j on j.id = cj.job_id
     where r.status in ('scheduled', 'completed', 'in_progress') and r.channel = 'phone'
       and r.scheduled_for between p_from and p_to and public.can_access_market(j.market_id)
    union all
    select jsonb_build_object('key', 'task:' || a.id, 'kind', 'task', 'title', a.title,
             'date', a.due_on, 'detail', coalesce(a.detail, ''),
             'href', case when a.candidate_id is not null then '/candidates/' || a.candidate_id
                            || coalesce('?job=' || a.candidate_job_id, '') else '/' end, 'done', false)
      from public.action_items a
     where a.status = 'open' and a.due_on is not null and a.kind in ('task', 'reminder')
       and a.due_on between (p_from at time zone 'America/New_York')::date and (p_to at time zone 'America/New_York')::date
       and (a.market_id is null or public.can_access_market(a.market_id))
    union all
    select jsonb_build_object('key', 'deal:' || d.id, 'kind', 'sales',
             'title', 'Sales: ' || coalesce(co.name, d.title) || ' · ' || d.next_step,
             'date', d.next_step_on, 'detail', d.title, 'href', '/deals/' || d.id, 'done', false)
      from public.deals d left join public.companies co on co.id = d.company_id
     where d.next_step_on is not null and coalesce(d.next_step, '') <> '' and d.stage not in ('won', 'lost')
       and d.next_step_on between (p_from at time zone 'America/New_York')::date and (p_to at time zone 'America/New_York')::date
       and public.can_access_market(d.market_id)
  ) x;
$$;
revoke execute on function public.calendar_events(timestamptz, timestamptz) from public, anon;
grant execute on function public.calendar_events(timestamptz, timestamptz) to authenticated;

-- For the Google push: the owner's Google account, its links, and what's coming up (read as the owner).
create or replace function public.calendar_feed(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare acct record; evs jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select g.staff_id, g.email, g.token_enc, g.scopes into acct
    from public.google_accounts g join public.staff s on s.id = g.staff_id
   where s.role = 'owner' and g.scopes like '%calendar%' order by g.connected_at desc limit 1;
  if acct.staff_id is null then return null; end if;
  -- calendar_events checks market access for the signed-in user; here we act as the owner.
  perform set_config('request.jwt.claim.sub', acct.staff_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', acct.staff_id, 'role', 'authenticated')::text, true);
  evs := public.calendar_events(now() - interval '1 day', now() + interval '60 days');
  return jsonb_build_object('staff_id', acct.staff_id, 'email', acct.email, 'token', acct.token_enc,
    'events', evs,
    -- Pushed events whose source was cancelled, finished or undated: they come off Google too.
    'gone', (select coalesce(jsonb_agg(l.source_key), '[]'::jsonb) from public.calendar_links l
              where l.staff_id = acct.staff_id and not l.removed and (
                (l.source_key like 'iv:%' and not exists (select 1 from public.interviews i
                   where i.id = substr(l.source_key, 4)::uuid and i.status in ('confirmed', 'done')))
                or (l.source_key like 'sc:%' and not exists (select 1 from public.screening_runs r
                   where r.id = substr(l.source_key, 4)::uuid and r.status in ('scheduled', 'completed', 'in_progress')))
                or (l.source_key like 'task:%' and not exists (select 1 from public.action_items a
                   where a.id = substr(l.source_key, 6)::uuid and a.status = 'open' and a.due_on is not null))
                or (l.source_key like 'deal:%' and not exists (select 1 from public.deals d
                   where d.id = substr(l.source_key, 6)::uuid and d.next_step_on is not null and d.stage not in ('won', 'lost'))))),
    'links', (select coalesce(jsonb_object_agg(source_key, jsonb_build_object('id', google_event_id, 'fp', fingerprint, 'removed', removed)), '{}'::jsonb)
                from public.calendar_links where staff_id = acct.staff_id));
end $$;
revoke execute on function public.calendar_feed(text) from public, anon, authenticated;
grant execute on function public.calendar_feed(text) to anon, authenticated;

create or replace function public.calendar_link_save(p_secret text, p_staff uuid, p_key text, p_event text, p_fp text, p_removed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.calendar_links (source_key, staff_id, google_event_id, fingerprint, removed, updated_at)
  values (p_key, p_staff, p_event, p_fp, p_removed, now())
  on conflict (source_key) do update set google_event_id = excluded.google_event_id, fingerprint = excluded.fingerprint,
    removed = excluded.removed, updated_at = now();
end $$;
revoke execute on function public.calendar_link_save(text, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.calendar_link_save(text, uuid, text, text, text, boolean) to anon, authenticated;
