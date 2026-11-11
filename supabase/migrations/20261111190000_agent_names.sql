-- Names Justin gives his AI agents (AI team page, 2026-11-11). Only the name is stored; what each agent does lives in code.
create table if not exists public.agent_names (
  key text primary key,
  name text not null,
  updated_at timestamptz not null default now()
);
alter table public.agent_names enable row level security;
create policy "owner all" on public.agent_names for all to authenticated using (public.is_owner()) with check (public.is_owner());
