-- Justin 2026-10-12: Ciarra's weekend replies about Sam and Kenneth vanished from What needs me because he
-- answered her about Gerald. A client's reply about one candidate now clears only when JPR writes back in that
-- same conversation (same client, same candidate job); a candidate's message still clears on any reply to them.
create or replace view public.needs_me with (security_invoker = true) as
 SELECT 'task:'::text || ai.id AS key, ai.kind, ai.title, ai.detail, ai.priority, ai.market_id, ai.company_id, ai.job_id,
    ai.candidate_id, ai.candidate_job_id, COALESCE(ai.due_on::timestamp with time zone, ai.created_at) AS since
   FROM action_items ai
  WHERE ai.status = 'open'::action_status AND ai.kind <> 'screening'::text
    AND NOT (ai.kind = 'reply'::text AND EXISTS (
      SELECT 1 FROM activities o
       WHERE o.direction = 'out'::text AND o.occurred_at > ai.created_at
         AND CASE
               WHEN ai.contact_id IS NOT NULL AND ai.candidate_job_id IS NOT NULL
                 THEN o.contact_id = ai.contact_id AND o.candidate_job_id = ai.candidate_job_id
               WHEN ai.contact_id IS NOT NULL THEN o.contact_id = ai.contact_id
               ELSE ai.candidate_id IS NOT NULL AND o.candidate_id = ai.candidate_id
             END))
UNION ALL
 SELECT 'protected:'::text || cj.id AS key, 'protected_client'::text AS kind, c.full_name || ' works at an active client'::text AS title,
    ('Current employer '::text || c.current_employer) || ' is protected. Confirm before any outreach.'::text AS detail,
    1 AS priority, j.market_id, j.company_id, j.id AS job_id, c.id AS candidate_id, cj.id AS candidate_job_id, cj.assigned_at AS since
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE (cj.stage = ANY (ARRAY['assigned'::pipeline_stage, 'contacting'::pipeline_stage])) AND is_protected_employer(c.current_employer)
UNION ALL
 SELECT 'contact:'::text || cj.id AS key, 'needs_contact'::text AS kind, 'Reach out to '::text || c.full_name AS title,
    ('Assigned to '::text || j.title) || ' with automated recruiting off, so this one is on you.'::text AS detail,
    2 AS priority, j.market_id, j.company_id, j.id AS job_id, c.id AS candidate_id, cj.id AS candidate_job_id, cj.assigned_at AS since
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE cj.stage = 'assigned'::pipeline_stage AND NOT is_protected_employer(c.current_employer) AND cj.assigned_at > (now() - '7 days'::interval)
    AND NOT (EXISTS (SELECT 1 FROM pursuits p WHERE p.candidate_job_id = cj.id AND p.status = 'active'::text))
UNION ALL
 SELECT 'submit:'::text || cj.id AS key, 'submission_ready'::text AS kind, 'Review submission: '::text || c.full_name AS title,
    ('Ready to submit for '::text || j.title) || '.'::text AS detail,
    1 AS priority, j.market_id, j.company_id, j.id AS job_id, c.id AS candidate_id, cj.id AS candidate_job_id, cj.stage_changed_at AS since
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE cj.stage = 'ready_to_submit'::pipeline_stage
UNION ALL
 SELECT 'renewal:'::text || a.id AS key, 'agreement_ending'::text AS kind,
    (co.name || ' agreement ends '::text) || to_char(a.end_date::timestamp with time zone, 'Mon DD'::text) AS title,
    initcap(a.type::text) || ' agreement ending within 30 days.'::text AS detail,
    2 AS priority, co.market_id, co.id AS company_id, NULL::uuid AS job_id, NULL::uuid AS candidate_id, NULL::uuid AS candidate_job_id,
    a.end_date::timestamp with time zone AS since
   FROM agreements a JOIN companies co ON co.id = a.company_id
  WHERE a.status = 'active'::agreement_status AND a.end_date >= CURRENT_DATE AND a.end_date <= (CURRENT_DATE + 30)
UNION ALL
 SELECT 'service:'::text || s.id AS key, 'service_renewal'::text AS kind,
    (s.name || ' renews '::text) || to_char(s.renews_on::timestamp with time zone, 'Mon DD'::text) AS title,
    COALESCE(('$'::text || s.cost::text) || ' · '::text, ''::text) || 'Decide whether to keep it.'::text AS detail,
    2 AS priority, NULL::uuid AS market_id, NULL::uuid AS company_id, NULL::uuid AS job_id, NULL::uuid AS candidate_id,
    NULL::uuid AS candidate_job_id, s.renews_on::timestamp with time zone AS since
   FROM services s
  WHERE s.status = 'active'::service_status AND s.renews_on >= CURRENT_DATE AND s.renews_on <= (CURRENT_DATE + 14)
UNION ALL
 SELECT 'deal:'::text || d.id AS key, 'deal_follow_up'::text AS kind, 'Follow up: '::text || d.title AS title,
    co.name || COALESCE(' · '::text || d.next_step, ''::text) AS detail,
    2 AS priority, d.market_id, d.company_id, NULL::uuid AS job_id, NULL::uuid AS candidate_id, NULL::uuid AS candidate_job_id,
    d.next_step_on::timestamp with time zone AS since
   FROM deals d JOIN companies co ON co.id = d.company_id
  WHERE (d.stage <> ALL (ARRAY['won'::deal_stage, 'lost'::deal_stage])) AND d.next_step_on <= CURRENT_DATE
UNION ALL
 SELECT 'invoice:'::text || p.id AS key, 'invoice_due'::text AS kind,
    (('Invoice '::text || co.name) || ' for '::text) || c.full_name AS title,
    ('Placement started '::text || to_char(p.start_date::timestamp with time zone, 'Mon DD'::text)) || '.'::text AS detail,
    1 AS priority, j.market_id, j.company_id, j.id AS job_id, c.id AS candidate_id, cj.id AS candidate_job_id,
    p.start_date::timestamp with time zone AS since
   FROM placements p JOIN candidate_jobs cj ON cj.id = p.candidate_job_id JOIN jobs j ON j.id = cj.job_id
     JOIN candidates c ON c.id = cj.candidate_id JOIN companies co ON co.id = j.company_id
  WHERE p.invoice_status = 'not_invoiced'::invoice_status AND p.start_date <= CURRENT_DATE;
