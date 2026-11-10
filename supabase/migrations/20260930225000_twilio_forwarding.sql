-- Calls to JPR's number forward to the owner's cell until the inbound phone agent exists (phase 6).
create or replace function public.twilio_forward_number(p_secret text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  return (select s.phone from public.staff s where s.role = 'owner' and s.active and s.phone is not null order by s.created_at limit 1);
end;
$$;
revoke execute on function public.twilio_forward_number(text) from public;
grant execute on function public.twilio_forward_number(text) to anon, authenticated;
