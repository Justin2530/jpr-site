-- Text relay: business texts are forwarded to the owner's cell, and the owner's replies from that cell go
-- back out from the business number to whoever texted most recently.
create or replace function public.twilio_relay_target(p_secret text) returns table (phone text, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  return query
    select a.phone_number, coalesce(c.full_name, ct.full_name, a.phone_number)
      from public.activities a
      left join public.candidates c on c.id = a.candidate_id
      left join public.contacts ct on ct.id = a.contact_id
     where a.kind = 'text' and a.direction = 'in' and a.phone_number is not null
       and public.phone_key(a.phone_number) is distinct from
           (select public.phone_key(s.phone) from public.staff s where s.role = 'owner' and s.active and s.phone is not null limit 1)
     order by a.occurred_at desc
     limit 1;
end;
$$;

create or replace function public.twilio_log_relay(p_secret text, p_sid text, p_to text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text := public.phone_key(p_to);
  cand_id uuid; cand_name text; cand_mkt uuid;
  con_id uuid; con_name text; con_co uuid; con_mkt uuid;
  owner uuid := (select s.id from public.staff s where s.role = 'owner' and s.active order by s.created_at limit 1);
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  select c.id, c.full_name, c.source_market_id into cand_id, cand_name, cand_mkt
    from public.candidates c where public.phone_key(c.phone) = k order by c.updated_at desc limit 1;
  select ct.id, ct.full_name, ct.company_id, co.market_id into con_id, con_name, con_co, con_mkt
    from public.contacts ct left join public.companies co on co.id = ct.company_id
    where public.phone_key(ct.phone) = k order by ct.created_at desc limit 1;
  insert into public.activities (kind, direction, summary, body, candidate_id, contact_id, company_id, market_id, actor_id, external_id, external_status, phone_number)
  values ('text', 'out', 'Text to ' || coalesce(cand_name, con_name, p_to) || ' (from your phone)', p_body, cand_id, con_id, con_co,
          coalesce(cand_mkt, con_mkt, (select m.id from public.markets m order by m.created_at limit 1)), owner, p_sid, 'queued', p_to)
  on conflict (external_id) where external_id is not null do nothing;
  -- Answering clears the matching "Text from" item on What needs me.
  update public.action_items set status = 'done', resolved_at = now(), resolved_by = owner
   where kind = 'reply' and status = 'open' and ((cand_id is not null and candidate_id = cand_id) or (con_id is not null and contact_id = con_id));
end;
$$;

revoke execute on function public.twilio_relay_target(text) from public;
revoke execute on function public.twilio_log_relay(text, text, text, text) from public;
grant execute on function public.twilio_relay_target(text) to anon, authenticated;
grant execute on function public.twilio_log_relay(text, text, text, text) to anon, authenticated;
