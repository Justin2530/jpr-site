-- Justin 2026-10-09 (Ciarra on Brandon: "I think we interviewed Brandon. I will let you know for sure."): when a
-- client has answered a submission but the thread then goes quiet for 3 business days with the candidate still
-- at Submitted, Justin gets a task to check in. Once per submission; nothing is sent automatically.
alter table public.submissions add column if not exists client_quiet_reminder_at timestamptz;

create or replace function public.client_call_reminders(p_secret text) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  for r in
    select s.id, s.sent_at, cj.id cj_id, cj.candidate_id, j.id job_id, j.title, j.company_id, j.market_id, c.full_name,
           (select ct.id from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_id,
           (select ct.full_name from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_name,
           (select ct.phone from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_phone
      from public.submissions s join public.candidate_jobs cj on cj.id = s.candidate_job_id
      join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
     where s.status = 'sent' and s.client_replied_at is null and s.client_call_reminder_at is null and cj.stage = 'submitted'
       and ((s.client_followup_at is not null and now() >= public.business_time(public.add_business_days(s.client_followup_at, 2)))
         or (s.client_followup_at is null and not public.automation_allowed(cj.id)
             and now() >= public.business_time(public.add_business_days(s.sent_at, 3))))
     for update of s skip locked
  loop
    update public.submissions set client_call_reminder_at = now() where id = r.id;
    insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, job_id, candidate_job_id, company_id, market_id)
    values ('task', 'Call ' || coalesce(r.contact_name, 'the client') || ' about ' || r.full_name,
            'No reply on the ' || r.title || ' submission since ' || to_char(r.sent_at at time zone 'America/New_York', 'Mon FMDD') ||
              coalesce(' · ' || r.contact_phone, '') || '.',
            1, r.candidate_id, r.contact_id, r.job_id, r.cj_id, r.company_id, r.market_id);
    n := n + 1;
  end loop;

  -- The client answered but hasn't come back since ("I'll let you know"): a check-in task after 3 quiet business days.
  for r in
    select s.id, cj.id cj_id, cj.candidate_id, j.id job_id, j.title, j.company_id, j.market_id, c.full_name, last.occurred_at last_at,
           last.body last_body,
           (select ct.id from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_id,
           (select ct.full_name from public.contacts ct where ct.id = any (s.to_contact_ids) limit 1) contact_name
      from public.submissions s join public.candidate_jobs cj on cj.id = s.candidate_job_id
      join public.jobs j on j.id = cj.job_id join public.candidates c on c.id = cj.candidate_id
      cross join lateral (select a.occurred_at, a.body from public.activities a
                           where a.external_thread_id = s.email_thread_id and a.direction = 'in'
                           order by a.occurred_at desc limit 1) last
     where s.status = 'sent' and s.client_replied_at is not null and s.client_quiet_reminder_at is null
       and s.email_thread_id is not null and cj.stage = 'submitted'
       and now() >= public.business_time(public.add_business_days(
             greatest(last.occurred_at, coalesce((select max(a.occurred_at) from public.activities a
                                                   where a.external_thread_id = s.email_thread_id), last.occurred_at)), 3))
     for update of s skip locked
  loop
    update public.submissions set client_quiet_reminder_at = now() where id = r.id;
    insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, job_id, candidate_job_id, company_id, market_id)
    values ('task', 'Check in with ' || coalesce(r.contact_name, 'the client') || ' about ' || r.full_name,
            'Nothing new on the ' || r.title || ' submission since they wrote on ' ||
              to_char(r.last_at at time zone 'America/New_York', 'Mon FMDD') || ': "' ||
              left(regexp_replace(split_part(coalesce(r.last_body, ''), E'\n\n', 1), '\s+', ' ', 'g'), 160) || '"',
            1, r.candidate_id, r.contact_id, r.job_id, r.cj_id, r.company_id, r.market_id);
    n := n + 1;
  end loop;
  return n;
end $$;
