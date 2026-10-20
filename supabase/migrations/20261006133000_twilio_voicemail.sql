-- A caller left JPR a voicemail: put the words on the call's activity and, when something was said,
-- add it to What needs me (it clears once anyone at JPR writes back, like a text).
create or replace function public.twilio_voicemail(p_secret text, p_sid text, p_seconds integer, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.activities%rowtype; who text; words text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  select * into a from public.activities where external_id = p_sid and kind = 'call' and direction = 'in';
  if not found then return; end if;
  who := coalesce(substring(a.summary from '^Call from (.*)$'), a.phone_number);
  update public.activities
     set summary = 'Voicemail from ' || who,
         body = coalesce(words, '(No message, ' || coalesce(p_seconds, 0) || ' seconds of silence)')
   where id = a.id and summary not like 'Voicemail from %';
  if not found or words is null then return; end if;
  insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, company_id, market_id)
  values ('reply', 'Voicemail from ' || who, left(words, 280), 1, a.candidate_id, a.contact_id, a.company_id, a.market_id);
end;
$$;
revoke execute on function public.twilio_voicemail(text, text, integer, text) from public;
grant execute on function public.twilio_voicemail(text, text, integer, text) to anon, authenticated;
