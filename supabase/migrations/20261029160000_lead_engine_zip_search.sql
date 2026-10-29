-- Lead Engine: each county is now searched one zip code at a time (Google shows only a handful of businesses
-- for a whole county), and every business is filed under the county its own zip is in, since Google also
-- shows businesses from outside the area searched. A task's county field carries the zip and town:
-- "Jefferson County|15767|Punxsutawney". The worker sends each business's county; a business found again
-- gets its county corrected.

create or replace function public.leads_save_task(p_secret text, p_task uuid, p_places jsonb, p_full boolean, p_error text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.lead_search_tasks;
  s public.lead_searches;
  p jsonb;
  bid uuid;
  inserted boolean;
  m record;
  n_found int := 0;
  n_new int := 0;
  dom text;
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  select * into t from public.lead_search_tasks where id = p_task for update;
  if not found or t.status <> 'running' then return jsonb_build_object('skipped', true); end if;
  select * into s from public.lead_searches where id = t.search_id for update;

  if p_error like 'HOLD:%' then
    -- Serper turned the key away (bad key, out of credits, too fast): not this search's fault, so the try
    -- doesn't count and the search waits, paused, until Justin fixes it and presses Resume.
    update public.lead_search_tasks set status = 'queued', attempts = greatest(attempts - 1, 0), locked_at = null,
           error = left(substr(p_error, 6), 500)
     where id = t.id;
    update public.lead_searches set status = 'paused', error = left(btrim(substr(p_error, 6)), 500)
     where id = s.id and status in ('queued', 'running');
    return jsonb_build_object('held', true);
  elsif p_error is not null then
    update public.lead_search_tasks
       set status = case when t.attempts >= 3 then 'failed'::public.lead_task_status else 'queued' end,
           error = left(p_error, 500), locked_at = null,
           done_at = case when t.attempts >= 3 then now() end
     where id = t.id;
    if t.attempts >= 3 then
      update public.lead_searches set failed_count = failed_count + 1, error = left(p_error, 500) where id = s.id;
    end if;
  else
    for p in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
      continue when coalesce(p->>'key', '') = '' or coalesce(p->>'name', '') = '';
      n_found := n_found + 1;
      -- One business with two Google listings (an old and a new one, or two names) shares a website: keep one
      -- record so it's emailed once. Shared hosts (Wix, Google Sites, Facebook...) don't count.
      dom := public.lead_domain(p->>'website');
      bid := null;
      if dom is not null and not public.lead_shared_host(dom)
         and not exists (select 1 from public.lead_businesses x where x.place_key = p->>'key') then
        select x.id into bid from public.lead_businesses x where x.domain = dom order by x.created_at limit 1;
      end if;
      if bid is not null then
        inserted := false;
        update public.lead_businesses b set
          phone = coalesce(b.phone, p->>'phone'),
          facebook_url = coalesce(b.facebook_url, p->>'facebook'),
          review_count = greatest(b.review_count, (p->>'reviews')::int),
          size_score = public.lead_size_score(greatest(b.review_count, (p->>'reviews')::int), b.website, b.category),
          updated_at = now()
         where b.id = bid;
      else
        insert into public.lead_businesses as b
          (place_key, name, category, address, city, county, state, zip, phone, website, domain, facebook_url, rating,
           review_count, lat, lng, size_score, first_search_id)
        values (p->>'key', p->>'name', p->>'category', p->>'address', p->>'city',
                -- the county the business's own zip is in (the worker works it out); older workers sent none
                case when p ? 'county' then nullif(p->>'county', '') else split_part(t.county, '|', 1) end,
                coalesce(nullif(p->>'state', ''), t.state), p->>'zip', p->>'phone', p->>'website',
                public.lead_domain(p->>'website'), p->>'facebook', (p->>'rating')::numeric, (p->>'reviews')::int,
                (p->>'lat')::double precision, (p->>'lng')::double precision,
                public.lead_size_score((p->>'reviews')::int, p->>'website', p->>'category'), s.id)
        on conflict (place_key) do update set
          county = coalesce(excluded.county, b.county),
          rating = coalesce(excluded.rating, b.rating),
          review_count = coalesce(excluded.review_count, b.review_count),
          phone = coalesce(b.phone, excluded.phone),
          website = coalesce(b.website, excluded.website),
          domain = coalesce(b.domain, excluded.domain),
          category = coalesce(b.category, excluded.category),
          facebook_url = coalesce(b.facebook_url, excluded.facebook_url),
          -- a website Google didn't have before gets read for emails
          enrich_status = case when b.website is null and excluded.website is not null then 'pending' else b.enrich_status end,
          enrich_attempts = case when b.website is null and excluded.website is not null then 0 else b.enrich_attempts end,
          size_score = public.lead_size_score(coalesce(excluded.review_count, b.review_count),
                                              coalesce(b.website, excluded.website), coalesce(b.category, excluded.category)),
          updated_at = now()
        returning b.id, (xmax = 0) into bid, inserted;
      end if;

      if inserted then
        select * into m from public.lead_match_company(p->>'name', public.lead_domain(p->>'website'));
        if m.company_id is not null then
          update public.lead_businesses
             set company_id = m.company_id, excluded_reason = case when m.status = 'client' then 'Active client' end
           where id = bid;
        end if;
      end if;

      insert into public.lead_list_members (business_id, line, search_id) values (bid, s.line, s.id)
      on conflict (business_id, line) do nothing;
      if found then n_new := n_new + 1; end if;
    end loop;

    update public.lead_search_tasks
       set status = 'done', results = n_found, new_results = n_new, error = null, locked_at = null, done_at = now()
     where id = t.id;
    update public.lead_searches
       set credits_used = credits_used + 1, found_count = found_count + n_found, new_count = new_count + n_new
     where id = s.id;
    if p_full and n_new > 0 and t.page < s.max_pages and s.status in ('queued', 'running') then
      insert into public.lead_search_tasks (search_id, state, county, keyword, page)
      values (s.id, t.state, t.county, t.keyword, t.page + 1)
      on conflict do nothing;
    end if;
  end if;

  -- Finished when nothing is left to run.
  update public.lead_searches
     set status = 'done', finished_at = now()
   where id = s.id and status in ('queued', 'running')
     and not exists (select 1 from public.lead_search_tasks k where k.search_id = s.id and k.status in ('queued', 'running'));
  return jsonb_build_object('found', n_found, 'new', n_new);
end; $$;
