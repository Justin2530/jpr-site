-- Numbers JPR's business line turns away before anything rings or answers (Justin 2026-10-21: "Block it",
-- about a robocaller that kept calling at 4 AM). Add a row to block another number.
create table if not exists public.blocked_numbers (
  phone text primary key, -- E.164, e.g. +19599006479
  reason text,
  created_at timestamptz not null default now()
);
alter table public.blocked_numbers enable row level security;

insert into public.blocked_numbers (phone, reason)
values ('+19599006479', 'Robocaller: 5 calls since Oct 6, 4 AM calls, never a real message')
on conflict (phone) do nothing;

create or replace function public.twilio_caller_blocked(p_secret text, p_from text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('twilio_webhook', p_secret) then
    raise exception 'unauthorized';
  end if;
  return exists (select 1 from public.blocked_numbers b
                  where right(regexp_replace(b.phone, '\D', '', 'g'), 10) = right(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'), 10)
                    and length(regexp_replace(coalesce(p_from, ''), '\D', '', 'g')) >= 10);
end;
$$;
revoke execute on function public.twilio_caller_blocked(text, text) from public;
grant execute on function public.twilio_caller_blocked(text, text) to anon, authenticated;
