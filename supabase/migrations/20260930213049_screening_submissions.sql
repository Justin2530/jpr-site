-- Per candidate+job record of the AI pre-submission call, the facts it gathered,
-- and the submission draft that waits for a human SEND / EDIT / HOLD / PASS.
create type public.screening_status as enum ('scheduled', 'in_progress', 'completed', 'no_answer', 'failed', 'cancelled');
create type public.submission_status as enum ('draft', 'sent', 'held', 'passed');

create table public.screening_runs (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null references public.candidate_jobs (id) on delete cascade,
  status public.screening_status not null default 'scheduled',
  channel text not null default 'phone',
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  summary text,
  -- [{ "speaker": "agent" | "candidate", "text": "...", "at": seconds }]
  transcript jsonb not null default '[]'::jsonb,
  candidate_questions text[] not null default '{}',
  concerns text[] not null default '{}',
  unresolved text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index screening_runs_cj_idx on public.screening_runs (candidate_job_id, created_at desc);

create table public.screening_facts (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null references public.candidate_jobs (id) on delete cascade,
  run_id uuid references public.screening_runs (id) on delete cascade,
  goal_id uuid references public.screening_goals (id) on delete set null,
  label text not null,
  value text,
  source text not null default 'ai' check (source in ('ai', 'human')),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index screening_facts_cj_idx on public.screening_facts (candidate_job_id, sort);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  candidate_job_id uuid not null references public.candidate_jobs (id) on delete cascade,
  run_id uuid references public.screening_runs (id) on delete set null,
  status public.submission_status not null default 'draft',
  subject text not null default '',
  body text not null default '',
  to_contact_ids uuid[] not null default '{}',
  drafted_by text not null default 'ai' check (drafted_by in ('ai', 'human')),
  decided_by uuid references public.staff (id) on delete set null,
  decided_at timestamptz,
  sent_at timestamptz,
  email_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submissions_cj_idx on public.submissions (candidate_job_id, created_at desc);

alter table public.screening_runs enable row level security;
alter table public.screening_facts enable row level security;
alter table public.submissions enable row level security;

create policy "market access" on public.screening_runs for all to authenticated
  using (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)))
  with check (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)));
create policy "market access" on public.screening_facts for all to authenticated
  using (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)))
  with check (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)));
create policy "market access" on public.submissions for all to authenticated
  using (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)))
  with check (exists (select 1 from public.candidate_jobs cj join public.jobs j on j.id = cj.job_id
                 where cj.id = candidate_job_id and public.can_access_market(j.market_id)));
grant select, insert, update, delete on public.screening_runs, public.screening_facts, public.submissions to authenticated;

-- Resumes can carry their text (parsed, pasted, or sample) for viewing and for the agents' context packets.
alter table public.resumes alter column storage_path drop not null;
alter table public.resumes add column text_content text;
