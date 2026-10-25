-- Public job postings for the website's SEO job pages and sitemap (JobPosting schema needs dates).
-- Same visibility rule as site_jobs: only open + public jobs, candidate-facing description only.
create or replace function public.site_job_postings()
returns table(id uuid, title text, location text, compensation text, schedule text, description text, opened_on date, updated_at timestamptz)
language sql stable security definer set search_path to ''
as $$
  select j.id, j.title, j.location, j.compensation, j.schedule, j.candidate_description,
         coalesce(j.opened_on, j.created_at::date), j.updated_at
    from public.jobs j
   where j.status = 'open' and j.visibility = 'public'
   order by j.opened_on desc nulls last, j.created_at desc;
$$;
revoke execute on function public.site_job_postings() from public;
grant execute on function public.site_job_postings() to anon, authenticated;
