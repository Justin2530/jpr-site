alter table public.companies add column is_sample boolean not null default false;
alter table public.candidates add column is_sample boolean not null default false;
