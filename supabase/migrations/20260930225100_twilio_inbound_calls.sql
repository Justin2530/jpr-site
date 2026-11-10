-- Who is calling JPR's number, for the announcement Justin hears before a forwarded call connects.
create or replace function public.twilio_caller_name(p_secret text, p_from text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare k text := public.phone_key(p_from);
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  if length(k) <> 10 then return null; end if;
  return coalesce(
    (select c.full_name from public.candidates c where public.phone_key(c.phone) = k order by c.updated_at desc limit 1),
    (select ct.full_name || coalesce(' at ' || co.name, '') from public.contacts ct left join public.companies co on co.id = ct.company_id
      where public.phone_key(ct.phone) = k order by ct.created_at desc limit 1));
end;
$$;
revoke execute on function public.twilio_caller_name(text, text) from public;
grant execute on function public.twilio_caller_name(text, text) to anon, authenticated;

-- A call to JPR's number: log it on the matching candidate or contact (length arrives via twilio_status).
create or replace function public.twilio_inbound_call(p_secret text, p_sid text, p_from text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text := public.phone_key(p_from);
  cand_id uuid; cand_name text; cand_mkt uuid;
  con_id uuid; con_name text; con_co uuid; con_mkt uuid;
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  if length(k) = 10 then
    select c.id, c.full_name, c.source_market_id into cand_id, cand_name, cand_mkt
      from public.candidates c where public.phone_key(c.phone) = k order by c.updated_at desc limit 1;
    select ct.id, ct.full_name, ct.company_id, co.market_id into con_id, con_name, con_co, con_mkt
      from public.contacts ct left join public.companies co on co.id = ct.company_id
      where public.phone_key(ct.phone) = k order by ct.created_at desc limit 1;
  end if;
  insert into public.activities (kind, direction, summary, candidate_id, contact_id, company_id, market_id, external_id, external_status, phone_number)
  values ('call', 'in', 'Call from ' || coalesce(cand_name, con_name, p_from), cand_id, con_id, con_co,
          coalesce(cand_mkt, con_mkt, (select m.id from public.markets m order by m.created_at limit 1)), p_sid, 'ringing', p_from)
  on conflict (external_id) where external_id is not null do nothing;
end;
$$;
revoke execute on function public.twilio_inbound_call(text, text, text) from public;
grant execute on function public.twilio_inbound_call(text, text, text) to anon, authenticated;
