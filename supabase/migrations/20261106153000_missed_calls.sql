-- Missed calls show up in What needs me (Justin 2026-11-06: "i should be able to know some one called and
-- know who and what for without needing to ask you"). A call to the business line that Justin didn't
-- answer, the assistant never came on for, and that left no voicemail becomes "Missed call from ...".

-- Justin took the forwarded call (pressed 1): mark the call so it never counts as missed.
create or replace function public.twilio_call_answered(p_secret text, p_sid text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then raise exception 'unauthorized'; end if;
  update public.activities set summary = summary || ' (you answered)'
   where external_id = p_sid and kind = 'call' and direction = 'in'
     and summary like 'Call from %' and summary not like '% (you answered)';
end $$;
revoke execute on function public.twilio_call_answered(text, text) from public;
grant execute on function public.twilio_call_answered(text, text) to anon, authenticated;

create or replace function public.twilio_status(p_secret text, p_sid text, p_status text, p_duration integer)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.activities%rowtype; rc public.reception_calls%rowtype; who text;
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  update public.activities
     set external_status = p_status, duration_seconds = coalesce(p_duration, duration_seconds)
   where external_id = p_sid;

  if p_status not in ('completed', 'no-answer', 'busy', 'failed', 'canceled') then return; end if;
  select * into a from public.activities where external_id = p_sid and kind = 'call' and direction = 'in';
  -- Only a plain "Call from ..." is unhandled: the assistant, voicemail and Justin each relabel it.
  if not found or a.summary not like 'Call from %' or a.summary like '% (you answered)'
     or a.summary like '%(answered by the AI assistant)' then return; end if;
  -- Justin calling his own line, or a candidate the screening agent took, isn't a missed call.
  if exists (select 1 from public.staff s where s.active and public.phone_key(s.phone) = public.phone_key(a.phone_number))
     or exists (select 1 from public.screening_runs r where r.call_sid = p_sid) then return; end if;
  select * into rc from public.reception_calls where call_sid = p_sid;
  if found then
    if rc.started_at is not null then return; end if;  -- the assistant talked to them; its write-up follows
    -- Handed to the assistant, but they hung up before it came on.
    update public.reception_calls set status = 'failed', ended_at = coalesce(ended_at, now()),
           process_note = 'They hung up before the assistant came on the line.'
     where id = rc.id and ended_at is null;
  end if;
  who := substring(a.summary from '^Call from (.*)$');
  if exists (select 1 from public.action_items i where i.status = 'open' and i.title = 'Missed call from ' || who
               and i.created_at > now() - interval '1 hour') then return; end if;
  insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, company_id, market_id)
  values ('task', 'Missed call from ' || who,
          'They hung up without leaving a message.' || coalesce(E'\nNumber: ' || a.phone_number, ''),
          2, a.candidate_id, a.contact_id, a.company_id, a.market_id);
end $$;

-- Same as before, plus: a voicemail that lands after the call ended clears the "Missed call" it replaces.
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
  if not found then return; end if;
  if words is null then return; end if;
  update public.action_items set status = 'done', resolved_at = now()
   where status = 'open' and title = 'Missed call from ' || who and created_at >= a.occurred_at;
  insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, company_id, market_id)
  values ('reply', 'Voicemail from ' || who, left(words, 280), 1, a.candidate_id, a.contact_id, a.company_id, a.market_id);
end $$;
