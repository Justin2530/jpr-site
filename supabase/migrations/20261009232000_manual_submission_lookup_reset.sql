-- Lets the Gmail submission look-up run again right away after a fix (clears the 30-minute wait).
create or replace function public.reset_submission_lookup() returns void
language sql security definer set search_path = '' as $$
  update public.candidate_jobs set submission_lookup_at = null where submission_lookup_at is not null;
$$;
revoke all on function public.reset_submission_lookup() from public, anon, authenticated;
