-- Skip only messages the reply brain still has (or escalated with its own note), not ones it finished earlier.
create or replace function public.triage_pending(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ai.id, 'title', ai.title, 'message', left(ai.detail, 3000),
             'from_kind', case when ai.candidate_id is not null then 'candidate' when ai.contact_id is not null then 'client contact' else 'unknown number or address' end))
      from (select * from public.action_items
             where kind = 'reply' and status = 'open' and triaged_at is null
               and not exists (select 1 from public.activities x
                                where x.candidate_id = action_items.candidate_id
                                  and x.brain_status in ('pending', 'working', 'escalated')
                                  and x.occurred_at between action_items.created_at - interval '10 minutes' and action_items.created_at)
             order by created_at limit 20) ai), '[]'::jsonb);
end $$;
revoke execute on function public.triage_pending(text) from public, anon, authenticated;
grant execute on function public.triage_pending(text) to anon, authenticated;
