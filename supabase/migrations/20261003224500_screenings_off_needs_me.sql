-- Booked screening calls don't need Justin (the voice agent makes them); they show under Coming up instead.
create or replace view public.needs_me with (security_invoker = true) as
 SELECT 'task:'::text || ai.id AS key, ai.kind, ai.title, ai.detail, ai.priority, ai.market_id, ai.company_id, ai.job_id,
    ai.candidate_id, ai.candidate_job_id, COALESCE(ai.due_on::timestamp with time zone, ai.created_at) AS since
   FROM action_items ai
  WHERE ai.status = 'open'::action_status
    AND ai.kind <> 'screening'  -- booked calls show under Coming up; the voice agent makes them
    -- A message stops waiting on Justin once anyone at JPR has written back to that person.
    AND NOT (ai.kind = 'reply' AND EXISTS (
      SELECT 1 FROM activities o
       WHERE o.direction = 'out' AND o.occurred_at > ai.created_at
         AND ((ai.candidate_id IS NOT NULL AND o.candidate_id = ai.candidate_id)
           OR (ai.contact_id IS NOT NULL AND o.contact_id = ai.contact_id))))
UNION ALL
 SELECT 'protected:'::text || cj.id, 'protected_client'::text, c.full_name || ' works at an active client'::text,
    ('Current employer '::text || c.current_employer) || ' is protected. Confirm before any outreach.'::text,
    1, j.market_id, j.company_id, j.id, c.id, cj.id, cj.assigned_at
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE (cj.stage = ANY (ARRAY['assigned'::pipeline_stage, 'contacting'::pipeline_stage])) AND is_protected_employer(c.current_employer)
UNION ALL
 SELECT 'contact:'::text || cj.id, 'needs_contact'::text, 'Reach out to '::text || c.full_name,
    ('Assigned to '::text || j.title) || ' with automated recruiting off, so this one is on you.'::text,
    2, j.market_id, j.company_id, j.id, c.id, cj.id, cj.assigned_at
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE cj.stage = 'assigned'::pipeline_stage AND NOT is_protected_employer(c.current_employer)
    AND cj.assigned_at > now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM pursuits p WHERE p.candidate_job_id = cj.id AND p.status = 'active')
UNION ALL
 SELECT 'submit:'::text || cj.id, 'submission_ready'::text, 'Review submission: '::text || c.full_name,
    ('Ready to submit for '::text || j.title) || '.'::text,
    1, j.market_id, j.company_id, j.id, c.id, cj.id, cj.stage_changed_at
   FROM candidate_jobs cj JOIN candidates c ON c.id = cj.candidate_id JOIN jobs j ON j.id = cj.job_id
  WHERE cj.stage = 'ready_to_submit'::pipeline_stage
UNION ALL
 SELECT 'renewal:'::text || a.id, 'agreement_ending'::text,
    (co.name || ' agreement ends '::text) || to_char(a.end_date::timestamp with time zone, 'Mon DD'::text),
    initcap(a.type::text) || ' agreement ending within 30 days.'::text,
    2, co.market_id, co.id, NULL::uuid, NULL::uuid, NULL::uuid, a.end_date::timestamp with time zone
   FROM agreements a JOIN companies co ON co.id = a.company_id
  WHERE a.status = 'active'::agreement_status AND a.end_date >= CURRENT_DATE AND a.end_date <= (CURRENT_DATE + 30)
UNION ALL
 SELECT 'service:'::text || s.id, 'service_renewal'::text,
    (s.name || ' renews '::text) || to_char(s.renews_on::timestamp with time zone, 'Mon DD'::text),
    COALESCE('$' || s.cost::text || ' · ', '') || 'Decide whether to keep it.',
    2, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, s.renews_on::timestamp with time zone
   FROM services s
  WHERE s.status = 'active'::service_status AND s.renews_on >= CURRENT_DATE AND s.renews_on <= (CURRENT_DATE + 14)
UNION ALL
 SELECT 'deal:'::text || d.id, 'deal_follow_up'::text, 'Follow up: '::text || d.title,
    co.name || COALESCE(' · ' || d.next_step, ''),
    2, d.market_id, d.company_id, NULL::uuid, NULL::uuid, NULL::uuid, d.next_step_on::timestamp with time zone
   FROM deals d JOIN companies co ON co.id = d.company_id
  WHERE d.stage <> ALL (ARRAY['won'::deal_stage, 'lost'::deal_stage]) AND d.next_step_on <= CURRENT_DATE
UNION ALL
 SELECT 'invoice:'::text || p.id, 'invoice_due'::text, 'Invoice '::text || co.name || ' for ' || c.full_name,
    'Placement started ' || to_char(p.start_date::timestamp with time zone, 'Mon DD'::text) || '.',
    1, j.market_id, j.company_id, j.id, c.id, cj.id, p.start_date::timestamp with time zone
   FROM placements p JOIN candidate_jobs cj ON cj.id = p.candidate_job_id JOIN jobs j ON j.id = cj.job_id
     JOIN candidates c ON c.id = cj.candidate_id JOIN companies co ON co.id = j.company_id
  WHERE p.invoice_status = 'not_invoiced'::invoice_status AND p.start_date <= CURRENT_DATE;

grant select on public.needs_me to authenticated;
