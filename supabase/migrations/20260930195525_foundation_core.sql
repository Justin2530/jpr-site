-- JPR Command Center foundation: markets, staff, CRM, jobs, candidates, pipeline, timeline, What Needs Me.

create type public.staff_role as enum ('owner', 'regional_director', 'market_director', 'recruiter');
create type public.company_status as enum ('prospect', 'client', 'former_client');
create type public.agreement_type as enum ('subscription', 'contingency');
create type public.agreement_status as enum ('draft', 'active', 'ended');
create type public.job_status as enum ('open', 'on_hold', 'filled', 'closed');
create type public.job_visibility as enum ('private', 'public', 'confidential');
create type public.candidate_source as enum ('indeed', 'linkedin', 'website', 'referral', 'database', 'direct_outreach', 'inbound', 'other');
create type public.pipeline_stage as enum ('assigned', 'contacting', 'conversation', 'ready_to_submit', 'submitted', 'interviewing', 'offer', 'placed', 'on_hold', 'passed', 'withdrawn');
create type public.action_status as enum ('open', 'done', 'dismissed');

-- Markets and staff ------------------------------------------------------

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  timezone text not null default 'America/New_York',
  phone text,
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.staff_role not null default 'recruiter',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff_invites (
  email text primary key,
  full_name text,
  role public.staff_role not null default 'recruiter',
  market_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.staff_markets (
  staff_id uuid not null references public.staff (id) on delete cascade,
  market_id uuid not null references public.markets (id) on delete cascade,
  primary key (staff_id, market_id)
);

-- Access helpers (security definer so policies can read staff tables) -----

create function public.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.id = (select auth.uid()) and s.active);
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.id = (select auth.uid()) and s.active and s.role = 'owner');
$$;

create function public.can_access_market(m uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_owner()
      or exists (
        select 1 from public.staff_markets sm
        join public.staff s on s.id = sm.staff_id
        where sm.staff_id = (select auth.uid()) and s.active and sm.market_id = m
      );
$$;

-- New logins become staff only if their email was invited.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.staff_invites;
begin
  select * into inv from public.staff_invites where lower(email) = lower(new.email);
  if found then
    insert into public.staff (id, email, full_name, role)
    values (new.id, new.email, inv.full_name, inv.role)
    on conflict (id) do nothing;
    insert into public.staff_markets (staff_id, market_id)
    select new.id, unnest(inv.market_ids)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- CRM ----------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets (id),
  name text not null,
  status public.company_status not null default 'prospect',
  industry text,
  website text,
  phone text,
  city text,
  notes text,
  created_by uuid default auth.uid() references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_market_idx on public.companies (market_id);
create index companies_name_idx on public.companies (lower(name));

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  full_name text not null,
  title text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);
create index contacts_company_idx on public.contacts (company_id);

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.agreement_type not null,
  status public.agreement_status not null default 'draft',
  plan_name text,
  monthly_price numeric(10, 2),
  search_capacity integer,
  fee_percent numeric(5, 2),
  candidate_ownership_months integer,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);
create index agreements_company_idx on public.agreements (company_id);

-- Jobs -----------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets (id),
  company_id uuid not null references public.companies (id),
  title text not null,
  location text,
  compensation text,
  schedule text,
  description text,
  candidate_description text,
  internal_notes text,
  status public.job_status not null default 'open',
  visibility public.job_visibility not null default 'private',
  hiring_contact_id uuid references public.contacts (id) on delete set null,
  priority smallint not null default 2 check (priority between 1 and 3),
  opened_on date not null default current_date,
  created_by uuid default auth.uid() references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_market_idx on public.jobs (market_id);
create index jobs_company_idx on public.jobs (company_id);

-- What the pre-submission conversation must find out for this job.
create table public.screening_goals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  prompt text not null,
  required boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index screening_goals_job_idx on public.screening_goals (job_id);

-- Candidates (JPR-wide identity) -------------------------------------------

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  city text,
  state text,
  current_employer text,
  current_title text,
  linkedin_url text,
  source public.candidate_source not null default 'indeed',
  source_market_id uuid references public.markets (id),
  sourced_by uuid default auth.uid() references public.staff (id) on delete set null,
  notes text,
  contact_consent boolean not null default false,
  contact_consent_note text,
  contact_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidates_name_idx on public.candidates (lower(full_name));
create index candidates_phone_idx on public.candidates (phone);
create index candidates_email_idx on public.candidates (lower(email));

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes integer,
  uploaded_by uuid default auth.uid() references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);
create index resumes_candidate_idx on public.resumes (candidate_id);

-- Candidate + job: the core workflow object. Creating one = "Assign to Job".
create table public.candidate_jobs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  stage public.pipeline_stage not null default 'assigned',
  assigned_by uuid default auth.uid() references public.staff (id) on delete set null,
  assigned_at timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  notes text,
  unique (candidate_id, job_id)
);
create index candidate_jobs_job_idx on public.candidate_jobs (job_id);

-- Timeline and human work queue --------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  kind text not null,
  summary text not null,
  actor_id uuid default auth.uid() references public.staff (id) on delete set null,
  market_id uuid references public.markets (id),
  company_id uuid references public.companies (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete cascade,
  candidate_job_id uuid references public.candidate_jobs (id) on delete cascade
);
create index activities_candidate_idx on public.activities (candidate_id, occurred_at desc);
create index activities_job_idx on public.activities (job_id, occurred_at desc);
create index activities_company_idx on public.activities (company_id, occurred_at desc);

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  market_id uuid references public.markets (id),
  kind text not null default 'task',
  title text not null,
  detail text,
  priority smallint not null default 2 check (priority between 1 and 3),
  status public.action_status not null default 'open',
  due_on date,
  company_id uuid references public.companies (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete cascade,
  candidate_job_id uuid references public.candidate_jobs (id) on delete cascade,
  created_by uuid default auth.uid() references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.staff (id) on delete set null
);
create index action_items_open_idx on public.action_items (status, market_id);

-- Triggers -----------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();
create trigger candidates_touch before update on public.candidates for each row execute function public.touch_updated_at();

create function public.log_candidate_job() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  j record;
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
  return new;
end;
$$;

create trigger candidate_jobs_log_insert after insert on public.candidate_jobs for each row execute function public.log_candidate_job();
create trigger candidate_jobs_log_update before update on public.candidate_jobs for each row execute function public.log_candidate_job();

-- Client protection: is this employer an active JPR client?
create function public.is_protected_employer(employer text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select employer is not null and exists (
    select 1 from public.companies c
    join public.agreements a on a.company_id = c.id
    where a.status = 'active'
      and (a.end_date is null or a.end_date >= current_date)
      and lower(trim(c.name)) = lower(trim(employer))
  );
$$;

-- What Needs Me: one queue, computed from live records plus manual tasks.
create view public.needs_me with (security_invoker = true) as
  select 'task:' || ai.id as key, ai.kind, ai.title, ai.detail, ai.priority, ai.market_id,
         ai.company_id, ai.job_id, ai.candidate_id, ai.candidate_job_id, coalesce(ai.due_on::timestamptz, ai.created_at) as since
  from public.action_items ai
  where ai.status = 'open'
union all
  select 'protected:' || cj.id, 'protected_client', c.full_name || ' works at an active client',
         'Current employer ' || c.current_employer || ' is protected. Confirm before any outreach.',
         1, j.market_id, j.company_id, j.id, c.id, cj.id, cj.assigned_at
  from public.candidate_jobs cj
  join public.candidates c on c.id = cj.candidate_id
  join public.jobs j on j.id = cj.job_id
  where cj.stage in ('assigned', 'contacting') and public.is_protected_employer(c.current_employer)
union all
  select 'contact:' || cj.id, 'needs_contact', 'Reach out to ' || c.full_name,
         'Assigned to ' || j.title || '. Automated follow-up arrives in phase 3; until then this is on you.',
         2, j.market_id, j.company_id, j.id, c.id, cj.id, cj.assigned_at
  from public.candidate_jobs cj
  join public.candidates c on c.id = cj.candidate_id
  join public.jobs j on j.id = cj.job_id
  where cj.stage = 'assigned' and not public.is_protected_employer(c.current_employer)
union all
  select 'submit:' || cj.id, 'submission_ready', 'Review submission: ' || c.full_name,
         'Ready to submit for ' || j.title || '.', 1, j.market_id, j.company_id, j.id, c.id, cj.id, cj.stage_changed_at
  from public.candidate_jobs cj
  join public.candidates c on c.id = cj.candidate_id
  join public.jobs j on j.id = cj.job_id
  where cj.stage = 'ready_to_submit'
union all
  select 'stale:' || j.id, 'stale_job', j.title || ' has had no candidate activity in 5 days',
         'Open since ' || to_char(j.opened_on, 'Mon DD') || '.', 2, j.market_id, j.company_id, j.id, null, null,
         coalesce((select max(cj.stage_changed_at) from public.candidate_jobs cj where cj.job_id = j.id), j.created_at)
  from public.jobs j
  where j.status = 'open'
    and coalesce((select max(cj.stage_changed_at) from public.candidate_jobs cj where cj.job_id = j.id), j.created_at) < now() - interval '5 days'
union all
  select 'renewal:' || a.id, 'agreement_ending', co.name || ' agreement ends ' || to_char(a.end_date, 'Mon DD'),
         initcap(a.type::text) || ' agreement ending within 30 days.', 2, co.market_id, co.id, null, null, null, a.end_date::timestamptz
  from public.agreements a
  join public.companies co on co.id = a.company_id
  where a.status = 'active' and a.end_date between current_date and current_date + 30;

-- Row level security ---------------------------------------------------------

alter table public.markets enable row level security;
alter table public.staff enable row level security;
alter table public.staff_invites enable row level security;
alter table public.staff_markets enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.agreements enable row level security;
alter table public.jobs enable row level security;
alter table public.screening_goals enable row level security;
alter table public.candidates enable row level security;
alter table public.resumes enable row level security;
alter table public.candidate_jobs enable row level security;
alter table public.activities enable row level security;
alter table public.action_items enable row level security;

create policy "staff read markets" on public.markets for select to authenticated using (public.is_staff());
create policy "owner manages markets" on public.markets for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "staff read staff" on public.staff for select to authenticated using (public.is_staff());
create policy "owner manages staff" on public.staff for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner manages invites" on public.staff_invites for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "staff read staff markets" on public.staff_markets for select to authenticated using (public.is_staff());
create policy "owner manages staff markets" on public.staff_markets for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "market access" on public.companies for all to authenticated
  using (public.can_access_market(market_id)) with check (public.can_access_market(market_id));
create policy "market access" on public.contacts for all to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and public.can_access_market(c.market_id)))
  with check (exists (select 1 from public.companies c where c.id = company_id and public.can_access_market(c.market_id)));
create policy "market access" on public.agreements for all to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and public.can_access_market(c.market_id)))
  with check (exists (select 1 from public.companies c where c.id = company_id and public.can_access_market(c.market_id)));
create policy "market access" on public.jobs for all to authenticated
  using (public.can_access_market(market_id)) with check (public.can_access_market(market_id));
create policy "market access" on public.screening_goals for all to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and public.can_access_market(j.market_id)))
  with check (exists (select 1 from public.jobs j where j.id = job_id and public.can_access_market(j.market_id)));
create policy "market access" on public.candidate_jobs for all to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and public.can_access_market(j.market_id)))
  with check (exists (select 1 from public.jobs j where j.id = job_id and public.can_access_market(j.market_id)));

create policy "staff access" on public.candidates for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff access" on public.resumes for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "market access" on public.activities for all to authenticated
  using (public.is_staff() and (market_id is null or public.can_access_market(market_id)))
  with check (public.is_staff() and (market_id is null or public.can_access_market(market_id)));
create policy "market access" on public.action_items for all to authenticated
  using (public.is_staff() and (market_id is null or public.can_access_market(market_id)))
  with check (public.is_staff() and (market_id is null or public.can_access_market(market_id)));

-- New tables are not exposed automatically in this project; grant explicitly to signed-in users only.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.markets, public.staff, public.staff_invites, public.staff_markets, public.companies, public.contacts,
  public.agreements, public.jobs, public.screening_goals, public.candidates, public.resumes,
  public.candidate_jobs, public.activities, public.action_items
to authenticated;
grant select on public.needs_me to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.is_staff(), public.is_owner(), public.can_access_market(uuid), public.is_protected_employer(text) to authenticated;
revoke execute on function public.is_staff(), public.is_owner(), public.can_access_market(uuid), public.is_protected_employer(text) from anon, public;

-- Resume storage: private bucket, staff only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('resumes', 'resumes', false, 10485760)
on conflict (id) do nothing;

create policy "staff read resumes" on storage.objects for select to authenticated using (bucket_id = 'resumes' and public.is_staff());
create policy "staff upload resumes" on storage.objects for insert to authenticated with check (bucket_id = 'resumes' and public.is_staff());
create policy "staff delete resumes" on storage.objects for delete to authenticated using (bucket_id = 'resumes' and public.is_staff());

-- Seed: market #1 and the owner invite.
insert into public.markets (name, slug) values ('Punxsutawney', 'punxsutawney');
insert into public.staff_invites (email, full_name, role, market_ids)
select 'justin@jpeacerecruiting.com', 'Justin', 'owner', array[id] from public.markets where slug = 'punxsutawney';
