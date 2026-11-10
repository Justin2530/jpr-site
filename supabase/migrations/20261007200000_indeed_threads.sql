-- Recruiting flow V1, build step 5: Indeed threads.
-- Indeed replies reach Justin's Gmail from a per-conversation relay address (conversation-...@indeedemail.com);
-- replying to it posts into the candidate's Indeed thread. Gmail sync links that address to the candidate,
-- and every automatic email (cadence and reply brain) goes to the Indeed thread when there is one, even
-- once we also have their real email. Justin's first Indeed messages stay manual.

alter table public.candidates add column if not exists indeed_relay text;
alter table public.candidates add column if not exists indeed_thread_id text;
alter table public.candidates add column if not exists indeed_subject text;
create index if not exists candidates_indeed_relay_idx on public.candidates (lower(indeed_relay)) where indeed_relay is not null;

-- Known people by email address; an Indeed relay address counts as the candidate's.
create or replace function public.gmail_person(p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('kind', 'contact', 'id', ct.id, 'name', ct.full_name, 'company_id', ct.company_id, 'market_id', co.market_id)
       from public.contacts ct left join public.companies co on co.id = ct.company_id
      where lower(trim(ct.email)) = lower(trim(p_email)) order by ct.created_at desc limit 1),
    (select jsonb_build_object('kind', 'candidate', 'id', c.id, 'name', c.full_name, 'company_id', null, 'market_id', c.source_market_id)
       from public.candidates c where lower(trim(c.email)) = lower(trim(p_email)) order by c.updated_at desc limit 1),
    (select jsonb_build_object('kind', 'candidate', 'id', c.id, 'name', c.full_name, 'company_id', null, 'market_id', c.source_market_id)
       from public.candidates c where lower(c.indeed_relay) = lower(trim(p_email)) order by c.updated_at desc limit 1))
$$;
revoke execute on function public.gmail_person(text) from public, anon, authenticated;

-- An incoming Indeed relay email: link it to the candidate (already linked by address, or a single
-- name match among people who came from Indeed) and remember the latest thread to reply in.
create or replace function public.gmail_indeed_link(p_secret text, p_from text, p_name text, p_thread text, p_subject text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cand uuid; clean text; parts text[]; n int;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if lower(p_from) not like '%@indeedemail.com' then return null; end if;
  select id into cand from public.candidates where lower(indeed_relay) = lower(trim(p_from)) order by updated_at desc limit 1;
  if cand is null then
    clean := lower(trim(regexp_replace(coalesce(p_name, ''), '\s+(via|from|on)\s+indeed.*$', '', 'i')));
    if clean = '' then return null; end if;
    -- Full name first, then first name + last initial ("Mike S."), only among Indeed candidates.
    select count(*), min(c.id::text)::uuid into n, cand from public.candidates c
     where lower(trim(c.full_name)) = clean and c.indeed_relay is null
       and (c.source = 'indeed' or exists (select 1 from public.candidate_jobs cj where cj.candidate_id = c.id and cj.outreach_source = 'indeed'));
    if n <> 1 then
      cand := null;
      parts := regexp_split_to_array(regexp_replace(clean, '\.', '', 'g'), '\s+');
      if array_length(parts, 1) >= 2 then
        select count(*), min(c.id::text)::uuid into n, cand from public.candidates c
         where split_part(lower(trim(c.full_name)), ' ', 1) = parts[1]
           and left(lower(regexp_replace(trim(c.full_name), '^.*\s', '')), 1) = left(parts[array_length(parts, 1)], 1)
           and c.indeed_relay is null
           and (c.source = 'indeed' or exists (select 1 from public.candidate_jobs cj where cj.candidate_id = c.id and cj.outreach_source = 'indeed'));
        if n <> 1 then cand := null; end if;
      end if;
    end if;
  end if;
  if cand is null then return null; end if;
  update public.candidates set indeed_relay = lower(trim(p_from)), indeed_thread_id = coalesce(nullif(p_thread, ''), indeed_thread_id),
         indeed_subject = coalesce(nullif(regexp_replace(coalesce(p_subject, ''), '^(re|fwd?):\s*', '', 'i'), ''), indeed_subject)
   where id = cand;
  return cand;
end $$;
revoke execute on function public.gmail_indeed_link(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.gmail_indeed_link(text, text, text, text, text) to anon, authenticated;

-- The cadence's emails go to the Indeed thread when the candidate has one.
create or replace function public.automation_indeed(p_secret text, p_candidate uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select jsonb_build_object('relay', c.indeed_relay, 'thread_id', c.indeed_thread_id, 'subject', c.indeed_subject)
            from public.candidates c where c.id = p_candidate and c.indeed_relay is not null and c.indeed_thread_id is not null);
end $$;
revoke execute on function public.automation_indeed(text, uuid) from public, anon, authenticated;
grant execute on function public.automation_indeed(text, uuid) to anon, authenticated;

-- The reply brain answers an Indeed thread on that thread.
create or replace function public.brain_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  -- Switched off: nothing automatic goes out. Replies stay on What needs me for Justin.
  if not exists (select 1 from public.automation_settings where automated_recruiting) then
    update public.activities set brain_status = null where brain_status = 'pending';
    return '[]'::jsonb;
  end if;
  with claimed as (
    update public.activities a set brain_status = 'working', brain_claimed_at = now()
     where a.id in (select id from public.activities
                     where brain_status = 'pending' or (brain_status = 'working' and brain_claimed_at < now() - interval '15 minutes')
                     order by occurred_at limit 5 for update skip locked)
    returning a.*)
  select coalesce(jsonb_agg(jsonb_build_object(
      'activity_id', c.id, 'channel', c.kind, 'body', left(c.body, 4000), 'summary', c.summary,
      'thread_id', c.external_thread_id, 'from_phone', c.phone_number,
      'candidate_id', cand.id, 'full_name', cand.full_name, 'phone', cand.phone,
      -- A reply that came in on their Indeed thread is answered there.
      'email', case when c.external_thread_id is not null and c.external_thread_id = cand.indeed_thread_id then cand.indeed_relay else cand.email end,
      'sms_opted_out', cand.sms_opted_out_at is not null,
      'candidate_job_id', cj.id, 'stage', cj.stage,
      'job_title', j.title, 'company', coalesce(nullif(co.short_name, ''), co.name), 'location', j.location,
      'compensation', j.compensation, 'schedule', j.schedule, 'job_summary', left(coalesce(j.candidate_description, j.description), 1500),
      'sender_staff_id', coalesce(p.started_by, cj.assigned_by),
      'booked_for', (select to_char(r.scheduled_for at time zone 'America/New_York', 'FMDay, Mon FMDD at FMHH12:MI AM')
                       from public.screening_runs r where r.candidate_job_id = cj.id and r.status = 'scheduled'
                      order by r.created_at desc limit 1),
      'gmail_email', g.email, 'gmail_token', g.token_enc,
      'history', (select coalesce(jsonb_agg(h order by h.at), '[]'::jsonb) from (
                    select x.occurred_at at, x.kind, x.direction, left(coalesce(x.body, x.summary), 1200) text
                      from public.activities x
                     where x.candidate_id = cand.id and x.kind in ('text', 'email', 'call') and x.id <> c.id
                     order by x.occurred_at desc limit 8) h)
    )), '[]'::jsonb) into out
    from claimed c
    join public.candidates cand on cand.id = c.candidate_id
    join public.candidate_jobs cj on cj.id = public.brain_job_for(cand.id)
    join public.jobs j on j.id = cj.job_id
    join public.companies co on co.id = j.company_id
    left join lateral (select started_by from public.pursuits where candidate_job_id = cj.id order by started_at desc limit 1) p on true
    left join public.google_accounts g on g.staff_id = coalesce(p.started_by, cj.assigned_by);
  update public.activities set brain_status = null
   where brain_status = 'working' and candidate_id is not null and public.brain_job_for(candidate_id) is null;
  return out;
end $$;

