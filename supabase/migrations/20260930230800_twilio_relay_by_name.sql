-- Who a reply from the owner's cell should go to. With a name ("Eric: see you at 3") it returns that person
-- if they texted in the last 30 days. Without one it returns everyone who texted in the last 24 hours, newest
-- first; the webhook only auto-sends when that's exactly one person and otherwise asks who it's for.
drop function if exists public.twilio_relay_target(text);
create or replace function public.twilio_relay_target(p_secret text, p_name text default null) returns table (phone text, name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  owner_key text := (select public.phone_key(s.phone) from public.staff s where s.role = 'owner' and s.active and s.phone is not null limit 1);
  n text := lower(trim(coalesce(p_name, '')));
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  return query
    select t.phone_number, t.who from (
      select distinct on (public.phone_key(a.phone_number)) a.phone_number, coalesce(c.full_name, ct.full_name, a.phone_number) as who, a.occurred_at
        from public.activities a
        left join public.candidates c on c.id = a.candidate_id
        left join public.contacts ct on ct.id = a.contact_id
       where a.kind = 'text' and a.direction = 'in' and a.phone_number is not null
         and public.phone_key(a.phone_number) is distinct from owner_key
         and case when n = '' then a.occurred_at > now() - interval '24 hours'
                  else a.occurred_at > now() - interval '30 days'
                       and (lower(coalesce(c.full_name, ct.full_name, '')) = n or lower(coalesce(c.full_name, ct.full_name, '')) like n || ' %') end
       order by public.phone_key(a.phone_number), a.occurred_at desc
    ) t
    order by t.occurred_at desc
    limit 10;
end;
$$;
revoke execute on function public.twilio_relay_target(text, text) from public;
grant execute on function public.twilio_relay_target(text, text) to anon, authenticated;
