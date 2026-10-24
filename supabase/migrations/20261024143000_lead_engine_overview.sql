-- The Lead Engine's Overview numbers for one list (WellThree's overview: totals, spend, cost per verified lead,
-- by state, by tier, Facebook queue). Owner only. Applied through the Supabase connector as "lead_engine_overview".
create or replace function public.lead_overview(p_line public.lead_line)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out jsonb;
begin
  if not public.is_owner() then raise exception 'not allowed'; end if;
  with m as (
    select b.*, l.status as list_status, l.exported_at from public.lead_list_members l
      join public.lead_businesses b on b.id = l.business_id where l.line = p_line
  ), sp as (
    select coalesce(sum(s.cost_usd), 0) as all_time,
           coalesce(sum(s.cost_usd) filter (where s.created_at >= date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York'), 0) as today
      from public.lead_spend s
      left join public.lead_searches q on q.id = s.search_id
     where q.line = p_line or s.search_id is null
  )
  select jsonb_build_object(
    'businesses', (select count(*) from m),
    'emails', (select count(*) from m where primary_email is not null),
    'deliverable', (select count(*) from m where email_verification = 'deliverable' and excluded_reason is null),
    'mx_ok', (select count(*) from m where email_status = 'mx_ok' and excluded_reason is null),
    'exported', (select count(*) from m where exported_at is not null),
    'customers', (select count(*) from m where list_status = 'customer'),
    'likely', (select count(*) from m where size_score >= 50),
    'spend_all', (select all_time from sp),
    'spend_today', (select today from sp),
    'per_state', coalesce((select jsonb_agg(x order by x->>'state') from (
        select jsonb_build_object('state', coalesce(state, '?'), 'total', count(*),
               'verified', count(*) filter (where email_verification = 'deliverable')) x
          from m group by state) z), '[]'),
    'per_tier', jsonb_build_object(
        'high', (select count(*) from m where size_score >= 50),
        'medium', (select count(*) from m where size_score >= 30 and size_score < 50),
        'low', (select count(*) from m where size_score < 30)),
    'fb_queue', coalesce((select jsonb_object_agg(fb_status, n) from (
        select fb_status, count(*) n from m where fb_status is not null group by fb_status) f), '{}')
  ) into out;
  return out;
end; $$;
revoke execute on function public.lead_overview(public.lead_line) from public, anon;
grant execute on function public.lead_overview(public.lead_line) to authenticated;
