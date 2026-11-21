-- Hunter.io emails for the master lead list (Justin bought Hunter Starter on 2026-11-21 after a free test: "remind
-- me to cancel once we have gotten our use out of it"). Hidden like lead_registry: no Command Center screens; the
-- results go to his Google Sheet. /api/registry/hunter does the work, one Domain Search per company website.
--
-- One row per website domain in the Sheet. status: pending, done (emails holds what Hunter knows, may be empty),
-- failed (error says why).
create table public.lead_registry_hunter (
  domain text primary key,
  filings text[] not null default '{}',
  status text not null default 'pending',
  tries int not null default 0,
  locked_at timestamptz,
  emails jsonb not null default '[]',      -- [{email, type, confidence, name, title, seniority}]
  organization text,
  pattern text,
  error text,
  searched_at timestamptz,
  created_at timestamptz not null default now()
);
create index lead_registry_hunter_status on public.lead_registry_hunter (status, domain);
alter table public.lead_registry_hunter enable row level security;

create or replace function public.lead_registry_hunter_claim(p_secret text, p_limit int)
returns table(domain text)
language plpgsql security definer set search_path to '' as $$
#variable_conflict use_column
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return query
  with c as (
    select h.domain from public.lead_registry_hunter h
    where h.status = 'pending' and h.tries < 3
      and (h.locked_at is null or h.locked_at < now() - interval '10 minutes')
    order by h.domain
    limit least(greatest(p_limit, 1), 200)
    for update skip locked
  )
  update public.lead_registry_hunter h set locked_at = now(), tries = h.tries + 1
  from c where h.domain = c.domain
  returning h.domain;
end $$;

-- A search finished (p_status done or failed), or couldn't run (p_status pending gives the try back).
create or replace function public.lead_registry_hunter_save(p_secret text, p_domain text, p_status text, p_emails jsonb,
  p_organization text, p_pattern text, p_error text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_hunter
     set status = p_status, emails = coalesce(p_emails, '[]'::jsonb), organization = p_organization, pattern = p_pattern,
         error = p_error, locked_at = null, searched_at = case when p_status = 'pending' then searched_at else now() end,
         tries = case when p_status = 'pending' then greatest(tries - 1, 0) else tries end
   where domain = p_domain;
end $$;

revoke all on function public.lead_registry_hunter_claim(text, int) from public;
revoke all on function public.lead_registry_hunter_save(text, text, text, jsonb, text, text, text) from public;
grant execute on function public.lead_registry_hunter_claim(text, int) to anon, authenticated;
grant execute on function public.lead_registry_hunter_save(text, text, text, jsonb, text, text, text) to anon, authenticated;
