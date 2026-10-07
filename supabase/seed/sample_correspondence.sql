-- Sample calls, texts and emails so the correspondence history has something to read.
-- Each row is tied to a sample candidate or sample company, so Clear sample data removes it.
create or replace function pg_temp.corr(p_kind text, p_dir text, p_cand text, p_contact text, p_summary text, p_body text, p_days numeric, p_mins numeric default null, p_job text default null)
returns void language plpgsql as $f$
declare v_cand uuid; v_ct uuid; v_co uuid; v_job uuid; v_deal uuid;
begin
  select id into v_cand from candidates where is_sample and full_name = p_cand;
  select ct.id, ct.company_id into v_ct, v_co from contacts ct join companies co on co.id = ct.company_id where co.is_sample and ct.full_name = p_contact;
  if p_job is not null then
    select id, company_id into v_job, v_co from jobs where title = p_job and company_id in (select id from companies where is_sample) limit 1;
  end if;
  select id into v_deal from deals where contact_id = v_ct and v_cand is null limit 1;
  if v_cand is null and v_ct is null then return; end if;
  if exists (select 1 from activities where summary = p_summary and coalesce(candidate_id, contact_id) = coalesce(v_cand, v_ct)) then return; end if;
  insert into activities (kind, direction, summary, body, duration_seconds, candidate_id, contact_id, company_id, job_id, deal_id, occurred_at)
  values (p_kind, p_dir, p_summary, p_body, (p_mins * 60)::int, v_cand, v_ct, v_co, v_job, v_deal, now() - make_interval(secs => (p_days * 86400)::double precision));
end $f$;

-- Candidates
select pg_temp.corr('text', 'out', 'Eric Neal', null, 'Intro text about the CNC Machinist role',
  E'Hi Eric, this is Justin with JPR in Punxsutawney. I came across your info and have a 2nd shift CNC role in town that could be a good step up from forklift work. $24-28/hr. Open to a quick call this week?', 5.2, null, 'CNC Machinist (2nd shift)');
select pg_temp.corr('text', 'in', 'Eric Neal', null, 'Eric replied: interested, call after 3',
  E'Yeah I''d be interested. I get off at 2:30, anytime after 3 works.', 5.1);
select pg_temp.corr('call', 'out', 'Eric Neal', null, 'Quick intro call with Eric',
  E'Talked about 10 min. Wants to get into machining, ran a manual lathe years ago. Prefers 2nd shift. Told him our assistant would call to go through the details and then I''d get him in front of the client. Also mentioned the Maintenance Tech opening; he wants to be considered for both.', 4.9, 11);
select pg_temp.corr('email', 'out', 'Eric Neal', null, 'Sent Eric both job descriptions',
  E'Subject: The two roles we talked about\n\nHi Eric,\n\nGreat talking with you today. Here are the two openings:\n\n1. CNC Machinist (2nd shift), $24-28/hr\n2. Maintenance Technician (1st shift), $27-32/hr\n\nOur assistant will give you a call in the next day or two to go over the details. Text me anytime with questions.\n\nJustin\nJPR', 4.8);
select pg_temp.corr('email', 'out', 'Amanda Grube', null, 'Office Manager details to Amanda',
  E'Subject: Office Manager in Punxsutawney\n\nHi Amanda,\n\nThanks for the quick reply. The role runs the front office for a busy clinic, M-F days, $52-58k plus benefits. I think your HR background is a real plus here.\n\nOur assistant will call to go over a few details, and then I''ll put your info together for the hiring manager.\n\nJustin', 3.5);
select pg_temp.corr('email', 'in', 'Amanda Grube', null, 'Amanda: sounds great, free after 4',
  E'Hi Justin,\n\nThis sounds great. I''m free most days after 4 if that works for the call.\n\nThanks,\nAmanda', 3.2);
select pg_temp.corr('text', 'out', 'Jason Bish', null, 'Intro text about the CNC role',
  E'Hi Jason, Justin with JPR here. Have a 2nd shift CNC opening in Punxsutawney, will train the right person. Worth a quick chat?', 2.4, null, 'CNC Machinist (2nd shift)');
select pg_temp.corr('text', 'out', 'Jason Bish', null, 'Follow-up text, no reply yet',
  E'Hey Jason, just following up on the CNC role. Let me know either way!', 1.2);
select pg_temp.corr('call', 'out', 'Marcus Reed', null, 'Prep call before his interview',
  E'Went over the interview with Dave Harrison Thursday at 2. Bring safety glasses, they''ll walk the floor. He''s solid on Haas setups; told him to talk about first-article inspection.', 3, 9);
select pg_temp.corr('text', 'in', 'Marcus Reed', null, 'Marcus: interview went well',
  E'Interview went good! Dave said they''d let me know by Monday.', 1.5);

-- Client contacts
select pg_temp.corr('call', 'out', null, 'Dave Harrison', 'Check-in with Dave on the CNC search',
  E'Dave says 2nd shift is short two people. Open to a trainee if attitude is right and they''ve run any machine before. Wants candidates who live within 30 minutes. Interviewing Marcus Reed Thursday.', 6, 14);
select pg_temp.corr('email', 'in', null, 'Dave Harrison', 'Dave: send anyone with lathe experience',
  E'Subject: Re: CNC search\n\nJustin,\n\nIf you find anyone with even basic lathe experience, send them over. We can train on the Haas. Second shift lead can do the training.\n\nDave', 4.5);
select pg_temp.corr('email', 'out', null, 'Karen Whitaker', 'Renewal conversation opener',
  E'Subject: Planning for next year\n\nHi Karen,\n\nWith Heather settled in, I wanted to talk about what hiring looks like for you next year. Our subscription covers up to 3 searches for $2k/month with no placement fees. Do you have 20 minutes next week?\n\nJustin', 2);
select pg_temp.corr('call', 'out', null, 'Mike Strouse', 'Proposal walkthrough with Mike',
  E'Walked Mike through the 3-search subscription. He likes not paying per hire. Needs sign-off from the owner; will get back to me by Friday. Main question: what if a search takes longer than expected.', 3, 22);
select pg_temp.corr('text', 'in', null, 'Mike Strouse', 'Mike: owner wants to meet',
  E'Owner wants to meet you before signing. Does Tuesday morning work?', 1);
select pg_temp.corr('text', 'out', null, 'Lisa Morgan', 'Update on the operator search',
  E'Hi Lisa, Derek accepted! He can start Monday. Cody Martz is also still available if you need a second operator.', 7);
select pg_temp.corr('email', 'out', null, 'Tom Kerr', 'Intro email to Tom',
  E'Subject: CDL drivers for Allegheny Freight\n\nHi Tom,\n\nI run JPR, a local recruiting firm in Punxsutawney. I know a lot of the regional CDL drivers in the area and saw you''re hiring. Would a quick call make sense?\n\nJustin', 6);

-- Sent submissions also show as emails in the history.
insert into activities (kind, direction, summary, body, candidate_id, contact_id, company_id, job_id, candidate_job_id, occurred_at)
select 'email', 'out', 'Submitted to client: ' || ct.full_name, 'Subject: ' || s.subject || E'\n\n' || s.body,
       cj.candidate_id, ct.id, j.company_id, j.id, cj.id, s.sent_at
from submissions s join candidate_jobs cj on cj.id = s.candidate_job_id join jobs j on j.id = cj.job_id
join candidates c on c.id = cj.candidate_id join contacts ct on ct.id = s.to_contact_ids[1]
where c.is_sample and s.status = 'sent'
  and not exists (select 1 from activities a where a.candidate_job_id = cj.id and a.kind = 'email' and a.summary like 'Submitted to client%');

-- A few reminders on sample records.
insert into action_items (kind, title, due_on, candidate_id, company_id, contact_id, market_id)
select 'reminder', x.title, current_date + x.days, c.id, ct.company_id, ct.id, (select id from markets limit 1)
from (values ('Text Jason Bish again if no reply', 1, 'Jason Bish', null),
             ('Call Mike Strouse to confirm Tuesday with the owner', 0, null, 'Mike Strouse'),
             ('Ask Dave Harrison for feedback on Marcus', 2, null, 'Dave Harrison')) as x(title, days, cand, contact)
left join candidates c on c.is_sample and c.full_name = x.cand
left join contacts ct on ct.full_name = x.contact and ct.company_id in (select id from companies where is_sample)
where not exists (select 1 from action_items a where a.title = x.title);
