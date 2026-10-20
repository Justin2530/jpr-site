-- Texting and calling through Twilio: provider ids on activities, opt-outs, Justin's cell for
-- click-to-call, and two narrow functions the Twilio webhooks call (no broad database access).

alter table public.staff add column if not exists phone text;

alter table public.activities
  add column if not exists external_id text,
  add column if not exists external_status text,
  add column if not exists phone_number text;
create unique index if not exists activities_external_id_key on public.activities (external_id) where external_id is not null;

alter table public.candidates add column if not exists sms_opted_out_at timestamptz;
alter table public.contacts add column if not exists sms_opted_out_at timestamptz;

-- Hashes of shared secrets the webhooks present. Nobody can read this table through the API.
create table if not exists public.integration_secrets (
  name text primary key,
  secret_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

create or replace function public.phone_key(p text) returns text
language sql immutable set search_path = '' as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

create or replace function public.integration_secret_ok(p_name text, p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.integration_secrets s
    where s.name = p_name and s.secret_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex')
  )
$$;
revoke execute on function public.integration_secret_ok(text, text) from public, anon, authenticated;

-- An incoming text: file it on the matching candidate or contact, flag it on What needs me,
-- and honor STOP.
create or replace function public.twilio_inbound_text(p_secret text, p_sid text, p_from text, p_to text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  k text := public.phone_key(p_from);
  cand_id uuid; cand_name text; cand_mkt uuid;
  con_id uuid; con_name text; con_co uuid; con_mkt uuid;
  mkt uuid;
  who text;
  opt_out boolean := upper(trim(coalesce(p_body, ''))) in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE');
  inserted uuid;
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
  mkt := coalesce(cand_mkt, con_mkt, (select m.id from public.markets m order by m.created_at limit 1));
  who := coalesce(cand_name, con_name, p_from);

  insert into public.activities (kind, direction, summary, body, candidate_id, contact_id, company_id, market_id, external_id, external_status, phone_number)
  values ('text', 'in', case when opt_out then 'Opted out of texts (' || who || ')' else 'Text from ' || who end, p_body,
          cand_id, con_id, con_co, mkt, p_sid, 'received', p_from)
  on conflict (external_id) where external_id is not null do nothing
  returning id into inserted;
  if inserted is null then
    return; -- Twilio retried a text we already have
  end if;

  if opt_out then
    update public.candidates set sms_opted_out_at = now() where id = cand_id;
    update public.contacts set sms_opted_out_at = now() where id = con_id;
  else
    insert into public.action_items (kind, title, detail, priority, candidate_id, contact_id, company_id, market_id)
    values ('reply', 'Text from ' || who, left(p_body, 280), 1, cand_id, con_id, con_co, mkt);
  end if;
end;
$$;

-- Delivery and call updates: sent / delivered / failed, and call length once it ends.
create or replace function public.twilio_status(p_secret text, p_sid text, p_status text, p_duration integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  update public.activities
     set external_status = p_status, duration_seconds = coalesce(p_duration, duration_seconds)
   where external_id = p_sid;
end;
$$;

revoke execute on function public.twilio_inbound_text(text, text, text, text, text) from public;
revoke execute on function public.twilio_status(text, text, text, integer) from public;
grant execute on function public.twilio_inbound_text(text, text, text, text, text) to anon, authenticated;
grant execute on function public.twilio_status(text, text, text, integer) to anon, authenticated;
