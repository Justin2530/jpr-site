-- Justin 2026-10-09, after adding 11 people through Send to JPR:
-- 1. Someone re-added through Send to JPR counts as just added (automation's "only new people" rule reads
--    created_at), so the original date is kept in first_added_at.
-- 2. A submission he sent from his own Gmail is found and recorded, so the client follow-up and interview
--    scheduling work for it exactly like one sent from the Command Center.
-- 3. One-time fixes: David Burnham counts as added today; Glenn Walker and Joseph Kramer move off the test job
--    onto ACME's 2nd-shift machinist job.

alter table public.candidates add column if not exists first_added_at timestamptz;
alter table public.candidate_jobs add column if not exists submission_lookup_at timestamptz;

-- Candidates at Submitted or later with no sent submission on file, for the tick to look for in Gmail: the
-- client's contact emails and company domain to match against. Checked at most every 30 minutes, for 14 days
-- after the stage change.
create or replace function public.manual_submissions_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
    select cj.id cj_id, c.full_name, j.title, cj.stage_changed_at since,
           coalesce((select array_agg(lower(ct.email)) from public.contacts ct where ct.company_id = j.company_id and ct.email is not null), '{}') emails
      from public.candidate_jobs cj
      join public.candidates c on c.id = cj.candidate_id
      join public.jobs j on j.id = cj.job_id
     where cj.stage in ('submitted', 'interviewing', 'offer')
       and cj.stage_changed_at > now() - interval '14 days'
       and (cj.submission_lookup_at is null or cj.submission_lookup_at < now() - interval '30 minutes')
       and not exists (select 1 from public.submissions s where s.candidate_job_id = cj.id and s.status = 'sent')
     limit 10) x;
  update public.candidate_jobs set submission_lookup_at = now()
   where id in (select (e->>'cj_id')::uuid from jsonb_array_elements(out) e);
  return out;
end $$;
revoke all on function public.manual_submissions_due(text) from public;
grant execute on function public.manual_submissions_due(text) to anon, authenticated;

-- Records the submission email found in Gmail as sent, with its thread, so replies and follow-ups line up.
create or replace function public.manual_submission_record(p_secret text, p_cj uuid, p_thread text, p_subject text,
                                                           p_sent_at timestamptz, p_to text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; comp uuid;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.submissions where candidate_job_id = p_cj and status = 'sent') then return null; end if;
  select j.company_id into comp from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id where cj.id = p_cj;
  insert into public.submissions (candidate_job_id, status, subject, body, to_contact_ids, drafted_by, sent_at, email_thread_id, decided_at)
  values (p_cj, 'sent', left(coalesce(p_subject, ''), 300), '',
          coalesce((select array_agg(ct.id) from public.contacts ct where ct.company_id = comp and lower(ct.email) = any (p_to)), '{}'),
          'human', p_sent_at, p_thread, p_sent_at)
  returning id into sid;
  return sid;
end $$;
revoke all on function public.manual_submission_record(text, uuid, text, text, timestamptz, text[]) from public;
grant execute on function public.manual_submission_record(text, uuid, text, text, timestamptz, text[]) to anon, authenticated;

-- One-time fixes.
create or replace function public.fix_capture_2026_10_09() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; m integer;
begin
  update public.candidates set first_added_at = coalesce(first_added_at, created_at), created_at = now()
   where full_name = 'David Burnham' and created_at < '2026-10-01';
  get diagnostics m = row_count; n := n + m;
  update public.candidate_jobs cj set job_id = '08c2dea0-87cf-4905-bd36-e1cd54399456'
    from public.candidates c
   where c.id = cj.candidate_id and c.full_name in ('Glenn Walker', 'Joseph Kramer')
     and cj.job_id = 'badec648-00ba-4c13-b7a6-f8738ea00bc4'
     and not exists (select 1 from public.candidate_jobs x where x.candidate_id = cj.candidate_id and x.job_id = '08c2dea0-87cf-4905-bd36-e1cd54399456');
  get diagnostics m = row_count; n := n + m;
  return n;
end $$;
revoke all on function public.fix_capture_2026_10_09() from public, anon, authenticated;
select public.fix_capture_2026_10_09();
