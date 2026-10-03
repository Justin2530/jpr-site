-- Latest read-only picture of an outside service's setup (e.g. Twilio texting registration), so the
-- owner and Claude can see it without logging into that service. No secrets or tax IDs go in here.
create table public.integration_snapshots (
  name text primary key,
  data jsonb not null,
  taken_at timestamptz not null default now()
);
alter table public.integration_snapshots enable row level security;
create policy "owner manages snapshots" on public.integration_snapshots for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
