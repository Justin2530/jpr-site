-- Messages tab: when each staff member last read a conversation, and phone notifications for new
-- incoming texts and emails from people on file.
create table if not exists public.message_reads (
  staff_id uuid not null references public.staff(id) on delete cascade,
  who text not null, -- 'c:<candidate id>' or 'p:<contact id>'
  read_at timestamptz not null default now(),
  primary key (staff_id, who)
);
alter table public.message_reads enable row level security;
create policy "own reads" on public.message_reads for all to authenticated
  using (staff_id = auth.uid() and public.is_staff()) with check (staff_id = auth.uid() and public.is_staff());

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  gone_at timestamptz
);
alter table public.push_subscriptions enable row level security;
create policy "own devices" on public.push_subscriptions for all to authenticated
  using (staff_id = auth.uid() and public.is_staff()) with check (staff_id = auth.uid() and public.is_staff());

alter table public.activities add column if not exists pushed_at timestamptz;

-- New incoming texts and emails from people on file (last 15 minutes, so backfilled mail never pings),
-- each claimed once.
create or replace function public.push_claim(p_secret text)
returns table (title text, body text, url text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  with due as (
    select a.id from public.activities a
     where a.kind in ('text', 'email') and a.direction = 'in' and a.pushed_at is null
       and (a.candidate_id is not null or a.contact_id is not null)
       and a.occurred_at > now() - interval '15 minutes'
     for update skip locked
  ), marked as (
    update public.activities a set pushed_at = now() from due where a.id = due.id
    returning a.kind, a.summary, a.body, a.candidate_id, a.contact_id
  )
  select (case when m.kind = 'text' then 'Text from ' else 'Email from ' end) || coalesce(c.full_name, ct.full_name, 'someone'),
         left(regexp_replace(coalesce(nullif(m.body, ''), m.summary), '\s+', ' ', 'g'), 160),
         '/messages/' || case when m.candidate_id is not null then 'c-' || m.candidate_id else 'p-' || m.contact_id end
    from marked m
    left join public.candidates c on c.id = m.candidate_id
    left join public.contacts ct on ct.id = m.contact_id;
end $$;

create or replace function public.push_devices(p_secret text)
returns table (endpoint text, p256dh text, auth text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s where s.gone_at is null;
end $$;

-- A device the push service says is gone (unsubscribed or app removed).
create or replace function public.push_forget(p_secret text, p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.push_subscriptions set gone_at = now() where endpoint = p_endpoint;
end $$;

revoke all on function public.push_claim(text), public.push_devices(text), public.push_forget(text, text) from public;
grant execute on function public.push_claim(text), public.push_devices(text), public.push_forget(text, text) to anon, authenticated;
