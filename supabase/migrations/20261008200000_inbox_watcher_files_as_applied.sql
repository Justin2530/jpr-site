-- The inbox watcher never assigns. Someone it finds goes on the job they mean as Applied,
-- waiting for Justin's review like a website applicant; only his assign moves them on.
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
      values (cand, job.id, 'applied', case when relay then 'indeed' end)
      returning id into cj;
      update public.activities set summary = 'Applied to ' || job.title || ' (found by the inbox watcher)'
       where candidate_job_id = cj and kind = 'assigned';
    end if;
  else
    select min(x.id::text)::uuid into cj from public.candidate_jobs x
     where x.candidate_id = cand and x.stage not in ('placed', 'passed', 'withdrawn')
    having count(*) = 1;
    if cj is not null then select j.* into job from public.jobs j join public.candidate_jobs x on x.job_id = j.id where x.id = cj; end if;
  end if;
  if cj is not null and kind in ('interested', 'message') then
    update public.candidate_jobs set stage = 'conversation', stage_changed_at = now()
     where id = cj and stage in ('assigned', 'contacting', 'couldnt_contact');
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

