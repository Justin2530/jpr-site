-- The public website (jpeacerecruiting.com) talks to the database only through these three functions,
-- using the publishable key. They never return client names or anything private.

-- Open jobs Justin marked Public, for the Open Jobs list. No company, no internal notes.
create or replace function public.site_jobs()
returns table (id uuid, title text, location text, compensation text, schedule text, description text)
language sql stable security definer set search_path = '' as $$
  select j.id, j.title, j.location, j.compensation, j.schedule, j.candidate_description
    from public.jobs j
   where j.status = 'open' and j.visibility = 'public'
   order by j.opened_on desc nulls last, j.created_at desc;
$$;

-- An employer's "Tell us what you're hiring for" form: goes straight to What needs me.
create or replace function public.site_hiring_request(
  p_name text, p_company text, p_email text, p_phone text, p_position text, p_location text, p_details text,
  p_sms_ok boolean, p_trap text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare who text := left(btrim(coalesce(p_name, '')), 120); co text := left(btrim(coalesce(p_company, '')), 160);
begin
  if coalesce(p_trap, '') <> '' then return true; end if;  -- bots fill the hidden field
  if who = '' or (coalesce(btrim(p_email), '') = '' and coalesce(btrim(p_phone), '') = '') then
    raise exception 'Please include your name and an email or phone number.';
  end if;
  if exists (select 1 from public.action_items a where a.kind = 'website_lead' and a.created_at > now() - interval '2 minutes'
              and a.title = 'Hiring request: ' || who || coalesce(' at ' || nullif(co, ''), '')) then
    return true;  -- double submit
  end if;
  insert into public.action_items (kind, title, detail, priority, market_id)
  values ('website_lead', 'Hiring request: ' || who || coalesce(' at ' || nullif(co, ''), ''),
          left(concat_ws(E'\n',
            'Position: ' || nullif(left(btrim(p_position), 160), ''),
            'Location: ' || nullif(left(btrim(p_location), 160), ''),
            'Email: ' || nullif(left(btrim(p_email), 200), ''),
            'Phone: ' || nullif(left(btrim(p_phone), 40), '') || case when p_sms_ok then ' (OK to text)' else '' end,
            nullif(left(btrim(p_details), 3000), '')), 4000),
          1, (select m.id from public.markets m order by m.created_at limit 1));
  return true;
end;
$$;

-- A job seeker's application: a new candidate (source website), placed in Applied on the job they picked.
-- Applied never starts automation; Justin decides. Texting consent comes only from the optional checkbox.
create or replace function public.site_application(
  p_name text, p_email text, p_phone text, p_city text, p_job uuid, p_history text, p_sms_ok boolean, p_trap text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  who text := left(btrim(coalesce(p_name, '')), 120);
  mail text := nullif(lower(left(btrim(coalesce(p_email, '')), 200)), '');
  tel text := nullif(left(btrim(coalesce(p_phone, '')), 40), '');
  job public.jobs%rowtype; cand uuid; mkt uuid;
begin
  if coalesce(p_trap, '') <> '' then return true; end if;
  if who = '' or (mail is null and tel is null) then
    raise exception 'Please include your name and an email or phone number.';
  end if;
  if p_job is not null then
    select * into job from public.jobs j where j.id = p_job and j.status = 'open' and j.visibility = 'public';
  end if;
  mkt := coalesce(job.market_id, (select m.id from public.markets m order by m.created_at limit 1));
  -- Same person applying again: reuse their record instead of making a copy.
  select c.id into cand from public.candidates c
   where (mail is not null and lower(c.email) = mail) or (tel is not null and public.phone_key(c.phone) = public.phone_key(tel))
   order by c.updated_at desc limit 1;
  if cand is null then
    insert into public.candidates (full_name, email, phone, city, source, source_market_id, notes,
                                   contact_consent, contact_consent_note, contact_consent_at)
    values (who, mail, tel, nullif(left(btrim(p_city), 120), ''), 'website', mkt,
            nullif(left(btrim(p_history), 4000), ''),
            coalesce(p_sms_ok, false),
            case when p_sms_ok then 'Checked the texting consent box on the website application' end,
            case when p_sms_ok then now() end)
    returning id into cand;
  elsif p_sms_ok then
    update public.candidates set contact_consent = true, contact_consent_at = now(),
           contact_consent_note = 'Checked the texting consent box on the website application'
     where id = cand;
  end if;
  if job.id is not null then
    insert into public.candidate_jobs (candidate_id, job_id, stage)
    values (cand, job.id, 'applied')
    on conflict do nothing;
  end if;
  insert into public.activities (kind, direction, summary, body, candidate_id, job_id, market_id)
  values ('note', 'in', 'Applied on the website' || coalesce(' for ' || job.title, ''),
          nullif(left(btrim(p_history), 4000), ''), cand, job.id, mkt);
  insert into public.action_items (kind, title, detail, priority, candidate_id, job_id, market_id)
  values ('website_lead', 'New applicant: ' || who || coalesce(' for ' || job.title, ''),
          left(concat_ws(E'\n', 'Email: ' || mail, 'Phone: ' || tel || case when p_sms_ok then ' (OK to text)' else '' end,
                         nullif(left(btrim(p_history), 600), '')), 1000),
          1, cand, job.id, mkt);
  return true;
end;
$$;

revoke execute on function public.site_jobs() from public;
revoke execute on function public.site_hiring_request(text, text, text, text, text, text, text, boolean, text) from public;
revoke execute on function public.site_application(text, text, text, text, uuid, text, boolean, text) from public;
grant execute on function public.site_jobs() to anon, authenticated;
grant execute on function public.site_hiring_request(text, text, text, text, text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.site_application(text, text, text, text, uuid, text, boolean, text) to anon, authenticated;
