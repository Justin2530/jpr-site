-- Website hiring requests are also emailed to Justin; notified_at marks the ones already sent.
alter table public.action_items add column if not exists notified_at timestamptz;

create or replace function public.website_leads_unsent(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'detail', a.detail, 'created_at', a.created_at))
      from (select * from public.action_items
             where kind = 'website_lead' and title like 'Hiring request:%' and notified_at is null
               and created_at > now() - interval '2 days'
             order by created_at limit 10) a), '[]'::jsonb);
end $$;

create or replace function public.website_lead_notified(p_secret text, p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.action_items set notified_at = now() where id = p_item and kind = 'website_lead';
end $$;

revoke execute on function public.website_leads_unsent(text) from public;
revoke execute on function public.website_lead_notified(text, uuid) from public;
grant execute on function public.website_leads_unsent(text) to anon, authenticated;
grant execute on function public.website_lead_notified(text, uuid) to anon, authenticated;
