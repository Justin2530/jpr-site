-- Tools & costs: every service JPR depends on, what it costs and what to watch.
create type public.service_status as enum ('active', 'planned', 'cancelled');
create type public.billing_cycle as enum ('free', 'monthly', 'yearly', 'usage');

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Other',
  purpose text,
  status public.service_status not null default 'active',
  plan text,
  billing public.billing_cycle not null default 'monthly',
  cost numeric(10,2),
  renews_on date,
  account_email text,
  login_url text,
  watch text,
  notes text,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger services_touch before update on public.services
  for each row execute function public.touch_updated_at();

alter table public.services enable row level security;
-- Costs and accounts are owner-only.
create policy services_owner_all on public.services for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
grant select, insert, update, delete on public.services to authenticated;

insert into public.services (name, category, purpose, status, plan, billing, cost, watch, notes, login_url, sort) values
  ('Supabase', 'Core app', 'Database, logins and file storage for the Command Center', 'active', 'Free', 'free', 0,
   'Free tier: 500 MB database, 1 GB file storage. Free projects pause after a week with no activity.', 'Move to Pro when real candidate data and resumes grow.', 'https://supabase.com/dashboard/org/mcbiempewmuszkjojkzu', 10),
  ('Vercel', 'Core app', 'Hosts the Command Center (and later the website)', 'active', 'Hobby', 'free', 0,
   'Hobby plan is for non-commercial use only.', 'Upgrade to Pro (about $20/mo) before going live for the business.', 'https://vercel.com/dashboard', 20),
  ('GitHub', 'Core app', 'Stores all of JPR''s code (repo jpr-site)', 'active', 'Free', 'free', 0, null, null, 'https://github.com/Justin2530/jpr-site', 30),
  ('Google Workspace', 'Communication', 'JPR email (justin@jpeacerecruiting.com), calendar, docs', 'active', null, 'monthly', null,
   null, 'Fill in plan and cost.', 'https://admin.google.com', 40),
  ('Twilio', 'Communication', 'Phone numbers, calls and texting from the Command Center', 'active', null, 'usage', null,
   'Pay-per-use: numbers, minutes and texts. Texting needs A2P 10DLC registration (one-time and monthly fees).', 'Account verified. Wired in during the follow-up phase.', 'https://console.twilio.com', 50),
  ('OpenAI API', 'AI', 'Runs JPR''s AI caller, screening and submission drafts', 'planned', null, 'usage', null,
   'Usage-based tokens and voice minutes. Set a monthly spend limit in the OpenAI dashboard.', 'Needed from the AI calls phase.', 'https://platform.openai.com/settings/organization/billing', 60),
  ('Trigger.dev', 'Core app', 'Runs timed follow-ups and workflows reliably', 'planned', null, 'monthly', null,
   null, 'Needed from the follow-up phase; free tier may be enough at first.', 'https://cloud.trigger.dev', 70),
  ('Claude', 'AI', 'Builds and maintains the Command Center', 'active', null, 'monthly', null,
   'Plan usage limits.', 'Fill in plan and cost.', 'https://claude.ai/settings/billing', 80),
  ('ChatGPT', 'AI', 'Planning and writing', 'active', null, 'monthly', null, null, 'Fill in plan and cost.', 'https://chatgpt.com', 90);

-- Add upcoming service renewals to What Needs Me (owner sees them through RLS).
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
  WHERE s.status = 'active'::service_status AND s.renews_on >= CURRENT_DATE AND s.renews_on <= (CURRENT_DATE + 14);

grant select on public.needs_me to authenticated;
