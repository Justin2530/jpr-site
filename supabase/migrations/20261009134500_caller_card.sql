-- One line telling Justin who is calling the business number, texted to his cell while it rings.
create or replace function public.twilio_caller_card(p_secret text, p_from text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare k text := public.phone_key(p_from); r record;
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then raise exception 'unauthorized'; end if;
  if length(k) <> 10 then return null; end if;
  select c.full_name,
         (select j.title || ' at ' || coalesce(nullif(co.short_name, ''), co.name)
            from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id join public.companies co on co.id = j.company_id
           where cj.candidate_id = c.id and cj.stage not in ('placed', 'passed', 'withdrawn')
           order by cj.stage_changed_at desc nulls last limit 1) job
    into r from public.candidates c where public.phone_key(c.phone) = k order by c.updated_at desc limit 1;
  if found then return 'Candidate: ' || r.full_name || coalesce(', ' || r.job, ''); end if;
  select ct.full_name, ct.title, coalesce(nullif(co.short_name, ''), co.name) company, co.status
    into r from public.contacts ct left join public.companies co on co.id = ct.company_id
   where public.phone_key(ct.phone) = k order by ct.created_at desc limit 1;
  if found then
    return case r.status when 'client' then 'Client: ' when 'prospect' then 'Prospect: ' else 'Contact: ' end
           || r.full_name || coalesce(', ' || r.company, '');
  end if;
  select coalesce(nullif(co.short_name, ''), co.name) company, co.status into r
    from public.companies co where public.phone_key(co.phone) = k limit 1;
  if found then
    return case r.status when 'client' then 'Client: ' when 'prospect' then 'Prospect: ' else 'Company: ' end || r.company;
  end if;
  return null;
end $$;
revoke execute on function public.twilio_caller_card(text, text) from public;
grant execute on function public.twilio_caller_card(text, text) to anon, authenticated;
