-- Sample AI calls, facts and submission drafts for the placeholder records (resumes are seeded in sample_resumes.sql).
-- Everything hangs off sample candidates, so the home page's Clear sample data removes it too.
create or replace function pg_temp.seed_run(p_name text, p_job text, p_kind text, p_mins int, p_summary text,
  p_spoken text[], p_facts text[], p_extra text[], p_questions text[], p_concerns text[], p_unresolved text[])
returns void language plpgsql as $f$
declare
  v_cj uuid; v_run uuid; v_job record; v_c record; v_hiring text; v_lines jsonb := '[]'; v_t int := 0; v_line record;
  v_days int := case when p_kind in ('draft', 'partial') then 1 else 8 end;
  v_labels text[] := array['Pay', 'Commute', 'Availability', 'Interest', 'Current situation'];
  v_prefix text[] := array['Pay expectations', 'Commute', 'Availability', 'Interest', 'Current situation'];
  v_body text; i int;
begin
  select cj.id into v_cj from candidate_jobs cj join candidates c on c.id = cj.candidate_id join jobs j on j.id = cj.job_id
   where c.is_sample and c.full_name = p_name and j.title = p_job;
  if v_cj is null or exists (select 1 from screening_runs where candidate_job_id = v_cj) then return; end if;
  select j.*, co.name as company into v_job from jobs j join companies co on co.id = j.company_id join candidate_jobs x on x.job_id = j.id where x.id = v_cj;
  select * into v_c from candidates where full_name = p_name and is_sample;
  select full_name into v_hiring from contacts where id = v_job.hiring_contact_id;

  if p_kind = 'noanswer' then
    insert into screening_runs (candidate_job_id, status, started_at, ended_at, duration_seconds, summary)
    values (v_cj, 'no_answer', now() - interval '2 days', now() - interval '2 days', 32, 'No answer. Left a short voicemail; follow-up text scheduled.');
    return;
  end if;

  -- Build the call script: agent asks each goal, candidate answers in their own words.
  create temp table if not exists seed_lines (n serial, speaker text, body text) on commit drop;
  truncate seed_lines;
  insert into seed_lines (speaker, body) values
    ('agent', format('Hi, is this %s? This is the JPR assistant calling on behalf of Justin at JPR. Just a heads up, this call is recorded and transcribed. Is now still a good time for a few minutes about the %s role?', split_part(p_name, ' ', 1), p_job)),
    ('candidate', 'Yeah, now''s fine.'),
    ('agent', format('Great. It''s with an established employer here in the area, %s, and pays %s. What would you need to make a move worth it?', coalesce(v_job.schedule, 'full time'), v_job.compensation)),
    ('candidate', coalesce(p_spoken[1], 'I''d have to think about that.')),
    ('agent', 'Got it. Where are you coming from, and does the drive work for you?'),
    ('candidate', coalesce(p_spoken[2], 'I''m not sure yet.')),
    ('agent', 'If it lined up, when could you start, and does the schedule fit?'),
    ('candidate', coalesce(p_spoken[3], 'Honestly I have to run, can we pick this up another time?'));
  if p_spoken[3] is null then
    insert into seed_lines (speaker, body) values ('agent', 'No problem at all. I''ll try you again soon. Thanks!');
  else
    insert into seed_lines (speaker, body) values ('agent', 'What''s got you interested in this one?'),
      ('candidate', coalesce(p_spoken[4], 'I''m still deciding if I''d want to leave what I''ve got.'));
    for i in 1 .. coalesce(array_length(p_questions, 1), 0) loop
      insert into seed_lines (speaker, body) values ('candidate', p_questions[i]),
        ('agent', 'Good question. I don''t want to guess on that, so I''ll have Justin get you a clear answer.');
    end loop;
    if p_kind = 'withdrawn' then
      insert into seed_lines (speaker, body) values ('agent', 'Totally understand, and thanks for being straight with me. I''ll let Justin know, and we''ll keep you in mind for something closer to home.');
    else
      insert into seed_lines (speaker, body) values
        ('agent', 'Perfect, that''s really all I needed. I''ll put this together with your resume for the hiring manager. If they''d like to set up an interview, we''ll be back in touch. Thanks for your time.'),
        ('candidate', 'Sounds good, thanks.');
    end if;
  end if;
  for v_line in select * from seed_lines order by n loop
    v_lines := v_lines || jsonb_build_object('speaker', v_line.speaker, 'text', v_line.body, 'at', v_t);
    v_t := v_t + 8 + length(v_line.body) / 12;
  end loop;

  insert into screening_runs (candidate_job_id, status, started_at, ended_at, duration_seconds, summary, transcript, candidate_questions, concerns, unresolved)
  values (v_cj, 'completed', now() - make_interval(days => v_days), now() - make_interval(days => v_days, mins => -p_mins), p_mins * 60 + 17,
          p_summary, v_lines, p_questions, p_concerns, p_unresolved)
  returning id into v_run;

  for i in 1 .. 5 loop
    insert into screening_facts (candidate_job_id, run_id, goal_id, label, value, sort)
    select v_cj, v_run, g.id, v_labels[i], p_facts[i], i from screening_goals g where g.job_id = v_job.id and g.prompt like v_prefix[i] || '%' limit 1;
  end loop;
  for i in 1 .. coalesce(array_length(p_extra, 1), 0) / 2 loop
    insert into screening_facts (candidate_job_id, run_id, label, value, sort) values (v_cj, v_run, p_extra[2 * i - 1], p_extra[2 * i], 10 + i);
  end loop;

  if p_kind in ('draft', 'sent', 'held', 'passed') then
    select string_agg('- ' || f.label || ': ' || f.value, E'\n' order by f.sort) into v_body from screening_facts f where f.run_id = v_run and f.value is not null;
    insert into submissions (candidate_job_id, run_id, status, subject, body, to_contact_ids, drafted_by, sent_at, decided_at, created_at)
    values (v_cj, v_run, (case p_kind when 'draft' then 'draft' else p_kind end)::submission_status,
      format('Candidate for %s: %s', p_job, p_name),
      format(E'Hi %s,\n\nI''d like to put %s in front of you for the %s opening. Resume attached.\n\n%s is currently a %s at %s and lives in %s. We talked this week; here''s what I learned:\n\n%s\n\nHappy to set up a time for you to meet. Just reply with a few times that work.\n\nThanks,\nJustin\nJPR',
        split_part(coalesce(v_hiring, 'there'), ' ', 1), p_name, p_job, split_part(p_name, ' ', 1), v_c.current_title, v_c.current_employer, v_c.city, v_body),
      array_remove(array[v_job.hiring_contact_id], null), 'ai',
      case when p_kind = 'sent' then now() - interval '7 days' end,
      case when p_kind <> 'draft' then now() - interval '7 days' end,
      now() - make_interval(days => v_days));
  end if;
end $f$;

-- Eric Neal is also in the Maintenance Technician search, so his page shows two job tabs.
insert into candidate_jobs (candidate_id, job_id, stage, assigned_at, stage_changed_at)
 select c.id, j.id, 'ready_to_submit', now() - interval '6 days', now() - interval '1 day' from candidates c, jobs j
 where c.is_sample and c.full_name = 'Eric Neal' and j.title = 'Maintenance Technician' on conflict do nothing;

select pg_temp.seed_run('Eric Neal', 'CNC Machinist (2nd shift)', 'draft', 7, 'Eric is interested and a good attitude fit. Pay and shift both work. Main gap is CNC experience: he''s run a manual lathe, not CNC, so this is a trainee-level submission.',
  array['I''d want about $25 to start. Anywhere in that range works for me.','I''m in Reynoldsville, so maybe 20 minutes. That''s no problem.','I''d give two weeks. Second shift is actually what I''d prefer.','I''ve been on a forklift six years. I ran a manual lathe back in 2016 and I''ve always wanted to get into CNC.']::text[],
  array['$25/hr to start; happy anywhere in the $24–28 range','Lives in Reynoldsville, about 20 minutes. Fine with it.','Can start with two weeks'' notice. 2nd shift works; he prefers it.','Wants to move from forklift work into machining; ran a manual lathe before and wants to learn CNC','At Warehouse Direct; needs to give two weeks']::text[],
  array['Machine experience','Manual lathe for about a year (2016); no CNC yet, but has done basic setups']::text[], array['Is there on-the-job CNC training?','Is overtime available on 2nd shift?']::text[], array['No CNC experience yet; client asked for 2+ years']::text[], array['Whether the client will consider a trainee']::text[]);
select pg_temp.seed_run('Eric Neal', 'Maintenance Technician', 'draft', 5, 'Solid interest and pay fits the bottom of the range. Mechanical but not electrical, so better as a junior tech.',
  array['For this one I''d need at least $27.','Same drive from Reynoldsville, 20 minutes or so.','Two weeks'' notice, and first shift is fine.','I like fixing stuff. I already do most of the forklift and conveyor repairs at the warehouse.']::text[],
  array['$27/hr minimum for this role','20 minutes from Reynoldsville; fine','Two weeks'' notice; 1st shift is fine','Likes fixing equipment; has done forklift and conveyor repairs at the warehouse','At Warehouse Direct; would give two weeks']::text[],
  array['Mechanical skills','Basic hydraulics and conveyor repair; no PLC']::text[], array['Would the company pay for electrical training?']::text[], array['No PLC or electrical experience']::text[], array[]::text[]);
select pg_temp.seed_run('Amanda Grube', 'Office Manager', 'draft', 8, 'Strong fit. Pay is inside the range, commute is okay, and she''s clearly motivated by running an office herself.',
  array['I''m hoping for around $55k, but I''d go to $52k if the benefits are good.','Indiana, so about 30 minutes. I''ve made that drive before.','I''d give three weeks. Monday to Friday days is perfect.','I want a smaller office where I actually run the whole front end.']::text[],
  array['$55k; open to $52k with good benefits','Indiana to Punxsutawney, about 30 minutes; she''s done it before','Available in three weeks; M–F days is ideal','Wants a smaller office where she runs the whole front end','HR Generalist at Indiana Regional; three weeks'' notice planned']::text[],
  array['Software','ADP, Microsoft Office, Google Workspace']::text[], array['How many people would she manage?','Is the role in-office every day?']::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Sarah Dinger', 'Heavy Equipment Operator', 'partial', 4, 'Call cut short; she had to go back to work. Pay and commute covered; availability still open.',
  array['I''d want $30 an hour.','DuBois to Brookville, 25 minutes maybe.',null,null]::text[],
  array['Wants $30/hr','DuBois to Brookville, about 25 minutes',null,'Wants to get back to running equipment outdoors',null]::text[],
  array[]::text[], array[]::text[], array['Coming from plant management; may expect more than $30/hr later']::text[], array['Start date and whether 50-hour weeks work']::text[]);
select pg_temp.seed_run('Tanya Kowalski', 'Maintenance Technician', 'partial', 6, 'Good skills match. Didn''t get a clear answer on why she''d close her business for a W-2 job.',
  array['$29 an hour.','I''m in Brookville, about 20 minutes.','I could start in a week. I''m self-employed right now.','Honestly I''m still figuring that out. I''ve had my own repair business a while.']::text[],
  array['$29/hr','Brookville, about 20 minutes','Could start in a week; self-employed',null,'Runs her own repair business; winding it down']::text[],
  array[]::text[], array['Is there a tool allowance?']::text[], array[]::text[], array['Interest: why she''d leave self-employment']::text[]);
select pg_temp.seed_run('Jason Bish', 'CNC Machinist (2nd shift)', 'noanswer', 0, null, '{}', '{}', '{}', '{}', '{}', '{}');
select pg_temp.seed_run('Josh Kness', 'Maintenance Technician', 'noanswer', 0, null, '{}', '{}', '{}', '{}', '{}', '{}');
select pg_temp.seed_run('Cody Martz', 'Heavy Equipment Operator', 'sent', 6, 'Good conversation. Pay, commute and schedule all line up. Motivation: tired of indoor shop work; ran a loader on his family farm.',
  array['$27 an hour would do it.','Reynoldsville, so 15 minutes.','Two weeks, and the seasonal hours don''t bother me.','I''m tired of being inside a shop. I ran a loader on my family''s farm for years.']::text[],
  array['$27/hr','Reynoldsville to Brookville, 15 minutes','Two weeks'' notice; seasonal hours fine','Tired of indoor shop work; ran a loader on his family farm','Welder at Keystone Steel']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Tyler Hetrick', 'CNC Machinist (2nd shift)', 'sent', 7, 'Good conversation. Pay, commute and schedule all line up. Motivation: wants to go from operating to setup.',
  array['$26 an hour.','DuBois, about 25 minutes.','Two weeks. I already work second shift.','I want to move up from just running parts to doing setups.']::text[],
  array['$26/hr','DuBois, 25 minutes','Two weeks; already works 2nd shift','Wants to go from operating to setup','Machine Operator at Punxsy Plastics']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Brianna Lott', 'Office Manager', 'sent', 9, 'Good conversation. Pay, commute and schedule all line up. Motivation: wants healthcare instead of banking.',
  array['$56k.','Indiana, about 30 minutes.','Two weeks.','I''d like to get into healthcare and out of banking.']::text[],
  array['$56k','Indiana, 30 minutes','Two weeks','Wants healthcare instead of banking','Office Manager at Dollar Bank']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Marcus Reed', 'CNC Machinist (2nd shift)', 'sent', 6, 'Good conversation. Pay, commute and schedule all line up. Motivation: current shop is cutting hours.',
  array['$28 an hour.','I live right in Punxsutawney, five minutes.','Two weeks, and second shift is fine.','My shop keeps cutting hours. I need something steady.']::text[],
  array['$28/hr','Lives in Punxsutawney, 5 minutes','Two weeks; 2nd shift fine','Current shop is cutting hours','CNC Machinist at Brookville Machining']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Derek Shaffer', 'Heavy Equipment Operator', 'sent', 5, 'Good conversation. Pay, commute and schedule all line up. Motivation: wants year-round work.',
  array['$29 an hour.','DuBois, about 25 minutes.','I''m available now.','I want year-round work instead of getting laid off every winter.']::text[],
  array['$29/hr','DuBois, 25 minutes','Available now','Wants year-round work','Between seasons at Clearfield Excavating']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Heather Yingling', 'Staff Accountant', 'sent', 8, 'Good conversation. Pay, commute and schedule all line up. Motivation: wants one employer instead of many clients.',
  array['$64k.','Big Run, 15 minutes.','Three weeks.','I''d rather work for one company than juggle a dozen clients.']::text[],
  array['$64k','Big Run, 15 minutes','Three weeks','Wants one employer instead of many clients','Staff Accountant at Riverside Accounting']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Kayla Stitt', 'Office Manager', 'held', 7, 'Good fit on paper, but she needs a month''s notice. Holding until the client''s start date is clear.',
  array['$58k.','Brookville, 20 minutes.','I''d need a month.','I want off the production floor.']::text[],
  array['$58k','Brookville, 20 minutes','One month','Wants off the production floor','Production Supervisor at Jeff Tech Molding']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Megan Snyder', 'CNC Machinist (2nd shift)', 'passed', 5, 'Pay expectation is above the range and interest is lukewarm. Recommend passing.',
  array['$30 an hour, and that''s firm.','Sykesville, about 30 minutes.','Two weeks.','I''m open to it. I''m not sure it''s a big step up for me.']::text[],
  array['$30/hr firm','Sykesville, 30 minutes','Two weeks','Open to it, not excited','Quality Inspector at Allegheny Parts']::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
select pg_temp.seed_run('Olivia Bowser', 'Heavy Equipment Operator', 'withdrawn', 3, 'Withdrew during the call. The commute is close to an hour and she decided the role isn''t for her.',
  array['I hadn''t really thought about pay yet.','Kittanning. That''s close to an hour.','I''d have to think about that.','You know what, I don''t think this one''s for me.']::text[],
  array[null,'Kittanning, 50 minutes',null,'Decided it''s not for her',null]::text[],
  array[]::text[], array[]::text[], array[]::text[], array[]::text[]);
