-- Sourced: people Justin or the inbox watcher found (e.g. replied to his Indeed message), waiting for his assign.
-- Applied stays for people who came to us. Only Justin moves anyone on to Assigned.
alter type public.pipeline_stage add value if not exists 'sourced' after 'applied';
