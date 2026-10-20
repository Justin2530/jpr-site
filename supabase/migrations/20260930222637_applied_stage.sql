-- Applicants (from the careers site or an import) sit in "Applied" until a person reviews them.
-- Moving a candidate to Assigned stays the one human action that can start automation.
alter type public.pipeline_stage add value if not exists 'applied' before 'assigned';
