-- Twilio's call quality report for each AI call (both legs), saved once it's ready (about 20 minutes
-- after the call). It flags silence and one-way audio, which is how a call can sound dead on the phone.
alter table public.screening_runs add column if not exists call_quality jsonb;

create or replace function public.screening_quality_due(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('run_id', r.id, 'call_sid', r.call_sid, 'ended_at', r.ended_at)), '[]'::jsonb)
            from (select id, call_sid, ended_at from public.screening_runs
                   where call_sid is not null and call_quality is null
                     and ended_at between now() - interval '2 days' and now() - interval '20 minutes'
                   order by ended_at desc limit 3) r);
end $$;

create or replace function public.screening_quality_save(p_secret text, p_run uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.integration_secret_ok('automation', p_secret) then raise exception 'unauthorized'; end if;
  update public.screening_runs set call_quality = p where id = p_run;
end $$;
