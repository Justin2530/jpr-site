-- Recruiting Flow V1: the Couldn't contact stage (day 16 with no response). Its own migration, since a
-- new enum value can't be used in the same transaction that adds it.
alter type public.pipeline_stage add value if not exists 'couldnt_contact' after 'withdrawn';
