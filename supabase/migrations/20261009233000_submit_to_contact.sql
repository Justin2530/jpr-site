-- Justin 2026-10-09: "Sierra [Ciarra Goodlin] should be the only person for Acme or Alcab that submissions go
-- to... It's one company with two locations." A company can name the one contact its submissions go to, even a
-- contact filed under a sister company. Submission drafts start addressed to them, and the Gmail look-up for
-- submissions he sent himself searches their address too.
alter table public.companies add column if not exists submit_to_contact_id uuid references public.contacts(id);

create or replace function public.set_submit_to_2026_10_09() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.companies set submit_to_contact_id = (select id from public.contacts where lower(email) = 'cgoodlin@acmemw.com' limit 1)
   where name ilike 'ACME Machine%' or name ilike 'ALKAB%';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_submit_to_2026_10_09() from public, anon, authenticated;
select public.set_submit_to_2026_10_09();

create or replace function public.manual_submissions_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into out from (
    select cj.id cj_id, c.full_name, j.title, cj.stage_changed_at since,
           coalesce((select array_agg(distinct lower(ct.email)) from public.contacts ct
                      where ct.email is not null and (ct.company_id = j.company_id or ct.id = co.submit_to_contact_id)), '{}') emails
      from public.candidate_jobs cj
      join public.candidates c on c.id = cj.candidate_id
      join public.jobs j on j.id = cj.job_id
      left join public.companies co on co.id = j.company_id
     where cj.stage in ('submitted', 'interviewing', 'offer')
       and cj.stage_changed_at > now() - interval '14 days'
       and (cj.submission_lookup_at is null or cj.submission_lookup_at < now() - interval '30 minutes')
       and not exists (select 1 from public.submissions s where s.candidate_job_id = cj.id and s.status = 'sent')
     limit 10) x;
  update public.candidate_jobs set submission_lookup_at = now()
   where id in (select (e->>'cj_id')::uuid from jsonb_array_elements(out) e);
  return out;
end $$;

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
          coalesce((select array_agg(ct.id) from public.contacts ct
                     where lower(ct.email) = any (p_to)
                       and (ct.company_id = comp or ct.id = (select submit_to_contact_id from public.companies where id = comp))), '{}'),
          'human', p_sent_at, p_thread, p_sent_at)
  returning id into sid;
  return sid;
end $$;

select public.reset_submission_lookup();
