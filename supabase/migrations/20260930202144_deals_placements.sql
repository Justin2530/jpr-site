-- Sales deals and recruiting placements, plus their What Needs Me items.
create type public.deal_stage as enum ('lead', 'contacted', 'meeting', 'proposal', 'won', 'lost');
create type public.invoice_status as enum ('not_invoiced', 'invoiced', 'paid', 'not_applicable');

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null,
  stage public.deal_stage not null default 'lead',
  deal_type public.agreement_type,
  value numeric(12,2),
  expected_close date,
  next_step text,
  next_step_on date,
  owner_id uuid references public.staff(id),
  notes text,
  stage_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_company_idx on public.deals(company_id);
create trigger deals_touch before update on public.deals for each row execute function public.touch_updated_at();

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null unique references public.candidate_jobs(id) on delete cascade,
  start_date date,
  compensation numeric(12,2),
  fee_percent numeric(5,2),
  fee_amount numeric(12,2),
  covered_by_subscription boolean not null default false,
  invoice_status public.invoice_status not null default 'not_invoiced',
  invoiced_on date,
  paid_on date,
  guarantee_until date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger placements_touch before update on public.placements for each row execute function public.touch_updated_at();

alter table public.activities add column deal_id uuid references public.deals(id) on delete cascade;
create index activities_deal_idx on public.activities(deal_id);

alter table public.deals enable row level security;
alter table public.placements enable row level security;
create policy "market access" on public.deals for all to authenticated
  using (public.can_access_market(market_id)) with check (public.can_access_market(market_id));
create policy "market access" on public.placements for all to authenticated
  using (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)))
  with check (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)));
grant select, insert, update, delete on public.deals, public.placements to authenticated;

-- Deal history, and a won deal turns a prospect into a client.
create or replace function public.log_deal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activities (kind, summary, market_id, company_id, deal_id, actor_id)
    values ('deal', 'New deal: ' || new.title, new.market_id, new.company_id, new.id, auth.uid());
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    new.closed_at := case when new.stage in ('won', 'lost') then now() else null end;
    insert into public.activities (kind, summary, market_id, company_id, deal_id, actor_id)
    values ('deal', new.title || ': ' || old.stage::text || ' → ' || new.stage::text, new.market_id, new.company_id, new.id, auth.uid());
    if new.stage = 'won' then
      update public.companies set status = 'client' where id = new.company_id and status <> 'client';
    end if;
  end if;
  return new;
end;
$$;
create trigger deals_log_insert after insert on public.deals for each row execute function public.log_deal();
create trigger deals_log_update before update on public.deals for each row execute function public.log_deal();

-- Moving a candidate to "placed" opens a placement record with the client's current terms.
create or replace function public.log_candidate_job()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  j record;
  sub_active boolean;
  fee numeric;
begin
  select jb.title, jb.market_id, jb.company_id into j from public.jobs jb where jb.id = new.job_id;
  if tg_op = 'INSERT' then
    insert into public.activities (kind, summary, market_id, company_id, job_id, candidate_id, candidate_job_id, actor_id)
    values ('assigned', 'Assigned to ' || j.title, j.market_id, j.company_id, new.job_id, new.candidate_id, new.id, auth.uid());
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    insert into public.activities (kind, summary, market_id, company_id, job_id, candidate_id, candidate_job_id, actor_id)
    values ('stage', j.title || ': ' || replace(old.stage::text, '_', ' ') || ' → ' || replace(new.stage::text, '_', ' '),
            j.market_id, j.company_id, new.job_id, new.candidate_id, new.id, auth.uid());
  end if;
  if new.stage = 'placed' and (tg_op = 'INSERT' or old.stage is distinct from 'placed') then
    select exists (select 1 from public.agreements a where a.company_id = j.company_id and a.type = 'subscription'
                   and a.status = 'active' and (a.end_date is null or a.end_date >= current_date)) into sub_active;
    select a.fee_percent into fee from public.agreements a where a.company_id = j.company_id and a.type = 'contingency'
      and a.status = 'active' order by a.created_at desc limit 1;
    insert into public.placements (candidate_job_id, covered_by_subscription, fee_percent, invoice_status)
    values (new.id, sub_active, case when sub_active then null else fee end,
            case when sub_active then 'not_applicable'::public.invoice_status else 'not_invoiced'::public.invoice_status end)
    on conflict (candidate_job_id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.log_deal() from public, anon, authenticated;

create or replace view public.needs_me with (security_invoker = true) as
 SELECT 'task:'::text || ai.id AS key, ai.kind, ai.title, ai.detail, ai.priority, ai.market_id, ai.company_id, ai.job_id,
    ai.candidate_id, ai.candidate_job_id, COALESCE(ai.due_on::timestamp with time zone, ai.created_at) AS since
   FROM action_items ai
  WHERE ai.status = 'open'::action_status
UNION ALL
 SELECT 'protected:'::text || cj.id, 'protected_client'::text, c.full_name || ' works at an active client'::text,
    ('Current employer '::text || c.current_employer) || ' is protected. Confirm before any outreach.'::text,
    1, j.market_id, j.company_id, j.id, c.id, cj.id, cj.assigned_at
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE (cj.stage = ANY (ARRAY['assigned'::pipeline_stage, 'contacting'::pipeline_stage])) AND is_protected_employer(c.current_employer)
UNION ALL
 SELECT 'contact:'::text || cj.id, 'needs_contact'::text, 'Reach out to '::text || c.full_name,
    ('Assigned to '::text || j.title) || '. Automated follow-up arrives in phase 3; until then this is on you.'::text,
    2, j.market_id, j.company_id, j.id, c.id, cj.id, cj.assigned_at
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE cj.stage = 'assigned'::pipeline_stage AND NOT is_protected_employer(c.current_employer)
UNION ALL
 SELECT 'submit:'::text || cj.id, 'submission_ready'::text, 'Review submission: '::text || c.full_name,
    ('Ready to submit for '::text || j.title) || '.'::text,
    1, j.market_id, j.company_id, j.id, c.id, cj.id, cj.stage_changed_at
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE cj.stage = 'ready_to_submit'::pipeline_stage
UNION ALL
 SELECT 'stale:'::text || j.id, 'stale_job'::text, j.title || ' has had no candidate activity in 5 days'::text,
    ('Open since '::text || to_char(j.opened_on::timestamp with time zone, 'Mon DD'::text)) || '.'::text,
    2, j.market_id, j.company_id, j.id, NULL::uuid, NULL::uuid,
    COALESCE((SELECT max(cj.stage_changed_at) FROM candidate_jobs cj WHERE cj.job_id = j.id), j.created_at)
   FROM jobs j
  WHERE j.status = 'open'::job_status
    AND COALESCE((SELECT max(cj.stage_changed_at) FROM candidate_jobs cj WHERE cj.job_id = j.id), j.created_at) < (now() - '5 days'::interval)
UNION ALL
 SELECT 'renewal:'::text || a.id, 'agreement_ending'::text,
    (co.name || ' agreement ends '::text) || to_char(a.end_date::timestamp with time zone, 'Mon DD'::text),
    initcap(a.type::text) || ' agreement ending within 30 days.'::text,
    2, co.market_id, co.id, NULL::uuid, NULL::uuid, NULL::uuid, a.end_date::timestamp with time zone
   FROM agreements a JOIN companies co ON co.id = a.company_id
  WHERE a.status = 'active'::agreement_status AND a.end_date >= CURRENT_DATE AND a.end_date <= (CURRENT_DATE + 30)
UNION ALL
 SELECT 'service:'::text || s.id, 'service_renewal'::text,
    (s.name || ' renews '::text) || to_char(s.renews_on::timestamp with time zone, 'Mon DD'::text),
    COALESCE('$' || s.cost::text || ' · ', '') || 'Decide whether to keep it.',
    2, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, s.renews_on::timestamp with time zone
   FROM services s
  WHERE s.status = 'active'::service_status AND s.renews_on >= CURRENT_DATE AND s.renews_on <= (CURRENT_DATE + 14)
UNION ALL
 SELECT 'deal:'::text || d.id, 'deal_follow_up'::text, 'Follow up: '::text || d.title,
    co.name || COALESCE(' · ' || d.next_step, ''),
    2, d.market_id, d.company_id, NULL::uuid, NULL::uuid, NULL::uuid, d.next_step_on::timestamp with time zone
   FROM deals d JOIN companies co ON co.id = d.company_id
  WHERE d.stage <> ALL (ARRAY['won'::deal_stage, 'lost'::deal_stage]) AND d.next_step_on <= CURRENT_DATE
UNION ALL
 SELECT 'invoice:'::text || p.id, 'invoice_due'::text, 'Invoice '::text || co.name || ' for ' || c.full_name,
    'Placement started ' || to_char(p.start_date::timestamp with time zone, 'Mon DD'::text) || '.',
    1, j.market_id, j.company_id, j.id, c.id, cj.id, p.start_date::timestamp with time zone
   FROM placements p JOIN candidate_jobs cj ON cj.id = p.candidate_job_id JOIN jobs j ON j.id = cj.job_id
     JOIN candidates c ON c.id = cj.candidate_id JOIN companies co ON co.id = j.company_id
  WHERE p.invoice_status = 'not_invoiced'::invoice_status AND p.start_date <= CURRENT_DATE;

grant select on public.needs_me to authenticated;
