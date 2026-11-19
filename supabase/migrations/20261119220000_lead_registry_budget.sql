-- Spend cap and pause switch for the PA registry research (Justin 2026-11-19: "finish all businesses"). The research
-- shares the OpenAI credit Jarvis and the phone agents run on, so it keeps a running total of what its AI reads cost
-- and stops handing out businesses at the cap, or as soon as an account runs out of credit. Additive: one new table
-- and one new function; claim and save gain the gate and the running total.
create table if not exists public.lead_registry_budget (
  id int primary key default 1 check (id = 1),
  cap_usd numeric not null default 2,
  spent_usd numeric not null default 0,
  researched int not null default 0,
  ai_reads int not null default 0,
  paused_reason text,
  paused_at timestamptz,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lead_registry_budget enable row level security;
insert into public.lead_registry_budget (id) values (1) on conflict (id) do nothing;

create or replace function public.lead_registry_claim(p_secret text, p_limit int)
returns setof public.lead_registry language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  -- Paused (an account ran out of credit) or at the OpenAI spend cap: hand out nothing.
  if exists (select 1 from public.lead_registry_budget b where b.paused_reason is not null or b.spent_usd >= b.cap_usd) then
    return;
  end if;
  return query
  update public.lead_registry r set research_locked_at = now(), research_attempts = r.research_attempts + 1
  where r.filing in (
    select filing from public.lead_registry
    where researched_at is null and removed_reason is null and research_attempts < 3
      and (research_locked_at is null or research_locked_at < now() - interval '10 minutes')
    order by priority, filing limit p_limit for update skip locked)
  returning r.*;
end $$;

create or replace function public.lead_registry_save(p_secret text, p_filing text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry set
    website = p_data->>'website', phone = p_data->>'phone', rating = (p_data->>'rating')::numeric,
    reviews = (p_data->>'reviews')::int, category = p_data->>'category', closed = (p_data->>'closed')::boolean,
    maps_address = p_data->>'maps_address', research = p_data->'research', employees_est = (p_data->>'employees_est')::int,
    size_guess = p_data->>'size_guess', email = p_data->>'email',
    emails = (select array_agg(x) from jsonb_array_elements_text(coalesce(p_data->'emails', '[]'::jsonb)) x), researched_at = now(), research_locked_at = null
  where filing = p_filing;
  update public.lead_registry_budget set
    spent_usd = spent_usd + coalesce((p_data->'research'->>'ai_cost')::numeric, 0),
    researched = researched + 1,
    ai_reads = ai_reads + case when p_data->'research' ? 'ai_cost' then 1 else 0 end,
    updated_at = now()
  where id = 1;
end $$;

create or replace function public.lead_registry_pause(p_secret text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.lead_registry_budget set paused_reason = left(p_reason, 300), paused_at = now(), updated_at = now()
  where id = 1 and paused_reason is null;
end $$;

revoke execute on function public.lead_registry_pause(text, text) from public;
grant execute on function public.lead_registry_pause(text, text) to anon, authenticated;
