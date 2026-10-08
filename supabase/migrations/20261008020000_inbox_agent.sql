-- The inbox agent: reads new mail in Justin's Gmail for potential candidates (Indeed first), adds them,
-- works out which job they mean, and answers their questions from that job's facts. It never recruits:
-- no outreach, texts or calls start until Justin puts someone on a job and picks "Yes, automate".
-- Its replies wait for Justin's OK (What needs me) until he turns on automatic replies in Settings.
-- It only reads mail that arrives after it was turned on.

alter table public.automation_settings add column if not exists inbox_agent_since timestamptz;
alter table public.automation_settings add column if not exists inbox_auto_reply boolean not null default false;

create or replace function public.set_inbox_agent(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings
     set inbox_agent_since = case when p_on then coalesce(inbox_agent_since, now()) end
   where id;
end $$;

create or replace function public.set_inbox_auto_reply(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.automation_settings set inbox_auto_reply = p_on where id;
end $$;
revoke execute on function public.set_inbox_agent(boolean), public.set_inbox_auto_reply(boolean) from public, anon;
grant execute on function public.set_inbox_agent(boolean), public.set_inbox_auto_reply(boolean) to authenticated;

-- Every message the agent has read, so it reads each one once.
create table if not exists public.inbox_triaged (
  gmail_id text primary key,
  kind text not null,
  candidate_id uuid references public.candidates (id),
  created_at timestamptz not null default now()
);
alter table public.inbox_triaged enable row level security;

-- A reply the agent wrote, waiting for Justin (or sent, when automatic replies are on).
create table if not exists public.inbox_drafts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id),
  candidate_job_id uuid references public.candidate_jobs (id),
  action_item_id uuid references public.action_items (id),
  staff_id uuid references public.staff (id),
  gmail_id text,
  to_address text not null,
  thread_id text,
  subject text not null,
  body text not null,
  status text not null default 'awaiting' check (status in ('awaiting', 'sent', 'skipped')),
  sent_message_id text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.inbox_drafts enable row level security;
create policy "staff read" on public.inbox_drafts for select to authenticated
  using (exists (select 1 from public.candidates c where c.id = candidate_id
                  and (public.is_owner() or public.can_access_market(c.source_market_id))));

-- What the agent needs for a pass: whether it's on, since when, and the open jobs it may talk about.
-- company is for telling jobs apart only; the agent never tells a candidate who the employer is.
create or replace function public.inbox_context(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select jsonb_build_object(
    'since', s.inbox_agent_since,
    'auto_reply', s.inbox_auto_reply,
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'title', j.title, 'company', coalesce(nullif(co.short_name, ''), co.name),
                                          'location', j.location, 'pay', j.compensation, 'schedule', j.schedule,
                                          'about', left(coalesce(nullif(j.candidate_description, ''), j.description, ''), 1500)))
        from public.jobs j join public.companies co on co.id = j.company_id
       where j.status = 'open' and not coalesce(co.is_sample, false)), '[]'::jsonb))
    from public.automation_settings s limit 1);
end $$;

-- Which of these Gmail ids the agent (or the mail log) has already seen.
create or replace function public.inbox_seen(p_secret text, p_ids text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return array(select gmail_id from public.inbox_triaged where gmail_id = any(p_ids));
end $$;

-- Who a sender is, as far as we know: a client contact (left alone), or a candidate with their open jobs.
-- brain: a candidate already in automated recruiting, whose replies the recruiting assistant answers.
create or replace function public.inbox_sender(p_secret text, p_from text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare who jsonb := public.gmail_person(p_from);
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  if who is null or who->>'kind' <> 'candidate' then return who; end if;
  return who || jsonb_build_object(
    'brain', public.brain_job_for((who->>'id')::uuid) is not null,
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('candidate_job_id', cj.id, 'job_id', cj.job_id, 'title', j.title, 'stage', cj.stage))
                        from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                       where cj.candidate_id = (who->>'id')::uuid
                         and cj.stage not in ('placed', 'passed', 'withdrawn')), '[]'::jsonb));
end $$;

-- File what the agent read. p: gmail_id, kind (interested | message | not_interested | job_seeker | other),
-- from, from_name, thread_id, subject, name, email, phone, job_id, message, summary, open_question,
-- needs_justin, resume_link, reply, auto_reply, staff_id.
-- Adds or finds the candidate (new ones come from Indeed or "inbound"), puts them on the job in
-- Conversation (no automation), and leaves Justin one item. Returns the ids the caller needs.
create or replace function public.inbox_file(p_secret text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  kind text := p->>'kind';
  addr text := lower(trim(p->>'from'));
  relay boolean := addr like '%@indeedemail.com';
  who jsonb; cand uuid; cj uuid; job public.jobs%rowtype; mkt uuid; nm text; item uuid; draft uuid;
  is_new boolean := false; title text; detail text;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  insert into public.inbox_triaged (gmail_id, kind) values (p->>'gmail_id', kind) on conflict do nothing;
  if not found then return null; end if;
  if kind not in ('interested', 'message', 'not_interested', 'job_seeker') then return null; end if;

  if nullif(p->>'job_id', '') is not null then
    select * into job from public.jobs j where j.id = (p->>'job_id')::uuid and j.status = 'open';
  end if;
  who := public.gmail_person(addr);
  if who->>'kind' = 'contact' then return null; end if;
  cand := (who->>'id')::uuid;
  if cand is null and nullif(p->>'email', '') is not null then
    select c.id into cand from public.candidates c where lower(c.email) = lower(trim(p->>'email')) order by c.updated_at desc limit 1;
  end if;
  if cand is null and nullif(p->>'phone', '') is not null and length(public.phone_key(p->>'phone')) = 10 then
    select c.id into cand from public.candidates c where public.phone_key(c.phone) = public.phone_key(p->>'phone') order by c.updated_at desc limit 1;
  end if;
  -- "Feedback from candidate X ... not interested" about someone we never added: nothing to file.
  if cand is null and kind = 'not_interested' then return null; end if;

  nm := left(coalesce(nullif(trim(p->>'name'), ''), nullif(trim(regexp_replace(coalesce(p->>'from_name', ''), '\s+(via|from|on)\s+indeed.*$', '', 'i')), ''), addr), 120);
  if nm = upper(nm) then nm := initcap(nm); end if;
  mkt := coalesce(job.market_id, (select m.id from public.markets m order by m.created_at limit 1));
  if cand is null then
    insert into public.candidates (full_name, email, phone, source, source_market_id, notes)
    values (nm, case when not relay then nullif(lower(trim(coalesce(nullif(p->>'email', ''), addr))), '') end,
            nullif(trim(p->>'phone'), ''), (case when relay then 'indeed' else 'inbound' end)::public.candidate_source, mkt,
            nullif(concat_ws(E'\n', 'Added by the inbox agent from ' || case when relay then 'an Indeed reply' else 'an email' end || '.',
                             'Indeed resume: ' || nullif(p->>'resume_link', '')), ''))
    returning id into cand;
    is_new := true;
  else
    update public.candidates set
      email = coalesce(email, case when not relay then nullif(lower(trim(coalesce(nullif(p->>'email', ''), addr))), '') end),
      phone = coalesce(phone, nullif(trim(p->>'phone'), '')),
      notes = case when nullif(p->>'resume_link', '') is not null and coalesce(notes, '') not like '%' || (p->>'resume_link') || '%'
                   then concat_ws(E'\n', notes, 'Indeed resume: ' || (p->>'resume_link')) else notes end
     where id = cand;
  end if;
  if relay then
    update public.candidates set indeed_relay = addr, indeed_thread_id = coalesce(nullif(p->>'thread_id', ''), indeed_thread_id),
           indeed_subject = coalesce(nullif(regexp_replace(coalesce(p->>'subject', ''), '^(re|fwd?):\s*', '', 'i'), ''), indeed_subject)
     where id = cand;
  end if;
  update public.inbox_triaged set candidate_id = cand where gmail_id = p->>'gmail_id';

  -- Their job: the one the agent named, else the only open one they're already on.
  if job.id is not null then
    select x.id into cj from public.candidate_jobs x where x.candidate_id = cand and x.job_id = job.id;
    if cj is null and kind <> 'not_interested' then
      insert into public.candidate_jobs (candidate_id, job_id, stage, outreach_source)
      values (cand, job.id, 'conversation', case when relay then 'indeed' end)
      returning id into cj;
    end if;
  else
    select min(x.id::text)::uuid into cj from public.candidate_jobs x
     where x.candidate_id = cand and x.stage not in ('placed', 'passed', 'withdrawn')
    having count(*) = 1;
    if cj is not null then select j.* into job from public.jobs j join public.candidate_jobs x on x.job_id = j.id where x.id = cj; end if;
  end if;
  if cj is not null and kind in ('interested', 'message') then
    update public.candidate_jobs set stage = 'conversation', stage_changed_at = now()
     where id = cj and stage in ('applied', 'assigned', 'contacting', 'couldnt_contact');
  end if;

  if kind = 'not_interested' then
    if cj is not null then
      update public.candidate_jobs set stage = 'withdrawn', stage_changed_at = now()
       where id = cj and stage in ('applied', 'assigned', 'contacting', 'conversation', 'couldnt_contact');
    end if;
    insert into public.activities (kind, direction, summary, body, candidate_id, job_id, candidate_job_id, market_id)
    values ('note', 'in', 'Said not interested on Indeed', p->>'summary', cand, job.id, cj, mkt);
    return jsonb_build_object('candidate_id', cand, 'candidate_job_id', cj);
  end if;

  title := case
    when is_new then 'New candidate: ' || nm || coalesce(' · ' || job.title, '')
    when kind = 'interested' then nm || ' is interested' || coalesce(' · ' || job.title, '')
    else 'Message from ' || nm || coalesce(' · ' || job.title, '') end;
  detail := concat_ws(E'\n',
    nullif(p->>'summary', ''),
    case when job.id is null then 'Which job? It wasn''t clear from the email, so they aren''t on a job yet.' end,
    'Asked: ' || nullif(p->>'open_question', ''),
    case when nullif(p->>'reply', '') is not null and coalesce((p->>'auto_reply')::boolean, false) then 'Answered automatically.'
         when nullif(p->>'reply', '') is not null then 'Reply drafted below for your OK.' end);
  insert into public.action_items (kind, title, detail, priority, candidate_id, job_id, candidate_job_id, market_id)
  values ('inbox', left(title, 200), left(detail, 1000),
          case when coalesce((p->>'needs_justin')::boolean, false) or nullif(p->>'open_question', '') is not null then 1 else 2 end,
          cand, job.id, cj, mkt)
  returning id into item;

  if nullif(p->>'reply', '') is not null then
    insert into public.inbox_drafts (candidate_id, candidate_job_id, action_item_id, staff_id, gmail_id, to_address, thread_id, subject, body)
    values (cand, cj, item, nullif(p->>'staff_id', '')::uuid, p->>'gmail_id', addr, nullif(p->>'thread_id', ''),
            case when coalesce(p->>'subject', '') ~* '^re:' then p->>'subject' else 'Re: ' || coalesce(nullif(p->>'subject', ''), job.title, 'your message') end,
            p->>'reply')
    returning id into draft;
  end if;
  return jsonb_build_object('candidate_id', cand, 'candidate_job_id', cj, 'item_id', item, 'draft_id', draft, 'new', is_new);
end $$;

-- A draft went out (automatically or on Justin's click): log it on their history and close it.
create or replace function public.inbox_draft_sent(p_secret text, p_draft uuid, p_message_id text, p_thread text, p_body text, p_staff uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.inbox_drafts;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.inbox_drafts set status = 'sent', body = p_body, sent_message_id = p_message_id, decided_by = p_staff, decided_at = now()
   where id = p_draft and status = 'awaiting' returning * into d;
  if d.id is null then return; end if;
  insert into public.activities (kind, direction, summary, body, candidate_id, candidate_job_id, job_id, market_id, actor_id,
                                 external_id, external_thread_id, external_status)
  select 'email', 'out', 'Inbox agent answered ' || c.full_name || case when p_staff is null then ' automatically' else '' end,
         p_body, c.id, d.candidate_job_id, cj.job_id, c.source_market_id, p_staff, p_message_id, p_thread, 'sent'
    from public.candidates c left join public.candidate_jobs cj on cj.id = d.candidate_job_id where c.id = d.candidate_id
  on conflict (external_id) where external_id is not null do nothing;
  if p_staff is not null then
    update public.action_items set status = 'done', resolved_at = now(), resolved_by = p_staff where id = d.action_item_id and status = 'open';
  end if;
end $$;

-- Justin chose not to send a draft.
create or replace function public.inbox_draft_skip(p_draft uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.inbox_drafts;
begin
  if not exists (select 1 from public.staff s where s.id = auth.uid() and s.active) then raise exception 'staff only'; end if;
  update public.inbox_drafts set status = 'skipped', decided_by = auth.uid(), decided_at = now()
   where id = p_draft and status = 'awaiting' returning * into d;
  update public.action_items set status = 'done', resolved_at = now(), resolved_by = auth.uid() where id = d.action_item_id and status = 'open';
end $$;

revoke execute on function public.inbox_context(text), public.inbox_seen(text, text[]), public.inbox_sender(text, text),
  public.inbox_file(text, jsonb), public.inbox_draft_sent(text, uuid, text, text, text, uuid) from public;
grant execute on function public.inbox_context(text), public.inbox_seen(text, text[]), public.inbox_sender(text, text),
  public.inbox_file(text, jsonb), public.inbox_draft_sent(text, uuid, text, text, text, uuid) to anon, authenticated;
revoke execute on function public.inbox_draft_skip(uuid) from public, anon;
grant execute on function public.inbox_draft_skip(uuid) to authenticated;

-- The mail log: a message the inbox agent filed already left Justin its own item, so it doesn't add a
-- second "Email from" one. It may also pass a cleaner summary and body (just what the candidate wrote).
create or replace function public.gmail_log(p_secret text, p_staff uuid, p_me text, p_msgs jsonb, p_synced_at timestamp with time zone)
 returns integer language plpgsql security definer set search_path to '' as $function$
declare m jsonb; outgoing boolean; who jsonb; addr text; added integer := 0; act uuid; name text; summary text;
  cand uuid; subj text; s_cj uuid; s_cand uuid; s_job uuid; s_name text; s_co uuid; s_mkt uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  for m in select value from jsonb_array_elements(p_msgs) order by (value->>'date')::bigint loop
    act := null;
    outgoing := lower(m->>'from') = lower(p_me);
    who := null;
    if outgoing then
      for addr in select jsonb_array_elements_text(m->'to') loop
        who := public.gmail_person(addr);
        exit when who is not null;
      end loop;
    else
      who := public.gmail_person(m->>'from');
    end if;
    select s.candidate_job_id, cj.candidate_id, cj.job_id, cand.full_name, j.company_id, j.market_id
      into s_cj, s_cand, s_job, s_name, s_co, s_mkt
      from public.submissions s join public.candidate_jobs cj on cj.id = s.candidate_job_id
      join public.candidates cand on cand.id = cj.candidate_id join public.jobs j on j.id = cj.job_id
     where s.email_thread_id = m->>'threadId' order by s.created_at desc limit 1;
    if who is null and s_cj is null then continue; end if;
    name := coalesce(who->>'name', m->>'fromName', m->>'from');
    subj := coalesce(nullif(m->>'subject', ''), '(no subject)');
    summary := case
      when outgoing then 'Email to ' || name || ': ' || subj
      when s_cj is not null then 'Reply on ' || s_name || '''s submission from ' || name
      when nullif(m->>'summary', '') is not null then m->>'summary'
      else 'Email from ' || name || ': ' || subj end;
    cand := case when who->>'kind' = 'candidate' then (who->>'id')::uuid else s_cand end;
    insert into public.activities (kind, direction, summary, body, occurred_at, candidate_id, contact_id, company_id, job_id,
                                   candidate_job_id, market_id, actor_id, external_id, external_thread_id, external_status)
    values ('email', case when outgoing then 'out' else 'in' end, summary, left(m->>'body', 20000),
            to_timestamp((m->>'date')::bigint / 1000.0), cand,
            case when who->>'kind' = 'contact' then (who->>'id')::uuid end,
            coalesce((who->>'company_id')::uuid, s_co), s_job, s_cj,
            coalesce((who->>'market_id')::uuid, s_mkt), case when outgoing then p_staff end,
            m->>'id', m->>'threadId', case when outgoing then 'sent' else 'received' end)
    on conflict (external_id) where external_id is not null do nothing
    returning id into act;
    if act is null then continue; end if;
    added := added + 1;
    if not outgoing and not coalesce((m->>'filed')::boolean, false) then
      insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, company_id, job_id, candidate_job_id, market_id)
      values ('reply', regexp_replace(summary, ': .*$', ''), left(coalesce(nullif(m->>'subject', '') || E'\n', '') || coalesce(m->>'body', ''), 280), 1,
              cand, case when who->>'kind' = 'contact' then (who->>'id')::uuid end,
              coalesce((who->>'company_id')::uuid, s_co), s_job, s_cj,
              coalesce((who->>'market_id')::uuid, s_mkt));
    end if;
  end loop;
  update public.google_accounts set last_synced_at = p_synced_at where staff_id = p_staff;
  return added;
end $function$;
