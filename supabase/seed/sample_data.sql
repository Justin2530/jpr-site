do $$
declare
  m uuid := 'd225707b-181b-4c0e-b15d-a5f7eb33f60e';
  me uuid := '08e4134d-9228-4736-9233-083c14537704';
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid;
  cand uuid[];
  cj uuid;
  i int;
  names text[] := array['Marcus Reed','Tanya Kowalski','Derek Shaffer','Brianna Lott','Cody Martz','Heather Yingling','Jason Bish','Kayla Stitt','Ryan Pifer','Amanda Grube','Tyler Hetrick','Megan Snyder','Josh Kness','Olivia Bowser','Eric Neal','Sarah Dinger'];
  titles text[] := array['CNC Machinist','Maintenance Tech','Heavy Equipment Operator','Office Manager','Welder','Staff Accountant','CDL-A Driver','Production Supervisor','Electrician','HR Generalist','Machine Operator','Quality Inspector','Mechanic','Payroll Specialist','Forklift Operator','Plant Manager'];
  employers text[] := array['Brookville Machining','Self-employed','Clearfield Excavating','Dollar Bank','Keystone Steel','Riverside Accounting','Penn Freight','Jeff Tech Molding','IBEW Local','Indiana Regional','Punxsy Plastics','Allegheny Parts','Route 36 Auto','Mahoning Health','Warehouse Direct','Northside Foundry'];
  towns text[] := array['Punxsutawney','Brookville','DuBois','Indiana','Reynoldsville','Big Run','Clearfield','Brookville','Punxsutawney','Indiana','DuBois','Sykesville','Punxsutawney','Kittanning','Reynoldsville','DuBois'];
  srcs candidate_source[] := array['indeed','linkedin','referral','indeed','indeed','linkedin','website','referral','indeed','linkedin','indeed','database','referral','indeed','inbound','linkedin']::candidate_source[];
begin
  insert into companies (name, status, industry, city, phone, market_id, is_sample, notes) values
    ('Sample: Mahoning Valley Fabrication','client','Metal fabrication','Punxsutawney','814-555-0101',m,true,'Sample data') returning id into c1;
  insert into companies (name, status, industry, city, phone, market_id, is_sample, notes) values
    ('Sample: Keystone Earthworks','client','Excavation & site work','Brookville','814-555-0102',m,true,'Sample data') returning id into c2;
  insert into companies (name, status, industry, city, phone, market_id, is_sample, notes) values
    ('Sample: Groundhog Country Health','client','Healthcare','Punxsutawney','814-555-0103',m,true,'Sample data') returning id into c3;
  insert into companies (name, status, industry, city, phone, market_id, is_sample, notes) values
    ('Sample: DuBois Precision Plastics','prospect','Plastics manufacturing','DuBois','814-555-0104',m,true,'Sample data') returning id into c4;
  insert into companies (name, status, industry, city, phone, market_id, is_sample, notes) values
    ('Sample: Jefferson County Credit Union','prospect','Banking','Brookville','814-555-0105',m,true,'Sample data') returning id into c5;
  insert into companies (name, status, industry, city, phone, market_id, is_sample, notes) values
    ('Sample: Allegheny Freight Lines','prospect','Trucking & logistics','Indiana','814-555-0106',m,true,'Sample data') returning id into c6;

  insert into contacts (company_id, full_name, title, phone, email) values (c1,'Dave Harrison','Plant Manager','814-555-0111','dave@example.com') returning id into p1;
  insert into contacts (company_id, full_name, title, phone, email) values (c2,'Lisa Morgan','Owner','814-555-0112','lisa@example.com') returning id into p2;
  insert into contacts (company_id, full_name, title, phone, email) values (c3,'Karen Whitaker','HR Director','814-555-0113','karen@example.com') returning id into p3;
  insert into contacts (company_id, full_name, title, phone, email) values (c4,'Mike Strouse','Operations Manager','814-555-0114','mike@example.com') returning id into p4;
  insert into contacts (company_id, full_name, title, phone, email) values (c5,'Beth Anthony','VP of Operations','814-555-0115','beth@example.com') returning id into p5;
  insert into contacts (company_id, full_name, title, phone, email) values (c6,'Tom Kerr','Terminal Manager','814-555-0116','tom@example.com') returning id into p6;
  insert into contacts (company_id, full_name, title, phone, email) values (c1,'Jen Boyer','HR Coordinator','814-555-0117','jen@example.com');

  insert into agreements (company_id, type, status, plan_name, monthly_price, search_capacity, start_date, end_date) values
    (c1,'subscription','active','Up to 3 searches',2000,3,current_date - 120, current_date + 245);
  insert into agreements (company_id, type, status, fee_percent, start_date) values (c2,'contingency','active',15,current_date - 60);
  insert into agreements (company_id, type, status, plan_name, monthly_price, search_capacity, start_date, end_date) values
    (c3,'subscription','active','1 search',1000,1,current_date - 340, current_date + 25);

  insert into jobs (title, company_id, market_id, location, compensation, schedule, priority, hiring_contact_id, opened_on, created_at, description) values
    ('CNC Machinist (2nd shift)', c1, m, 'Punxsutawney', '$24–28/hr', '2nd shift, M–F', 1, p1, current_date - 21, now() - interval '21 days', 'Set up and run Haas mills. Read blueprints.') returning id into j1;
  insert into jobs (title, company_id, market_id, location, compensation, schedule, priority, hiring_contact_id, opened_on, created_at) values
    ('Maintenance Technician', c1, m, 'Punxsutawney', '$27–32/hr', '1st shift', 2, p1, current_date - 9, now() - interval '9 days') returning id into j2;
  insert into jobs (title, company_id, market_id, location, compensation, schedule, priority, hiring_contact_id, opened_on, created_at) values
    ('Heavy Equipment Operator', c2, m, 'Brookville', '$25–30/hr', 'Seasonal, 50 hrs/wk', 1, p2, current_date - 34, now() - interval '34 days') returning id into j3;
  insert into jobs (title, company_id, market_id, location, compensation, schedule, priority, hiring_contact_id, opened_on, created_at) values
    ('Office Manager', c3, m, 'Punxsutawney', '$52–58k', 'M–F days', 2, p3, current_date - 45, now() - interval '45 days') returning id into j4;
  insert into jobs (title, company_id, market_id, location, compensation, schedule, priority, hiring_contact_id, opened_on, created_at, status) values
    ('Staff Accountant', c3, m, 'Punxsutawney', '$60–68k', 'Hybrid', 3, p3, current_date - 80, now() - interval '80 days', 'filled') returning id into j5;

  insert into screening_goals (job_id, prompt, required, sort)
  select j, g.prompt, g.req, g.s from unnest(array[j1,j2,j3,j4,j5]) j,
    (values ('Pay expectations and whether this job''s pay works', true, 0),
            ('Commute: where they live and whether the location works', true, 1),
            ('Availability: when they could start and schedule fit', true, 2),
            ('Interest in this role and why they''d move', true, 3),
            ('Current situation and notice needed at current job', false, 4)) g(prompt, req, s);

  cand := array[]::uuid[];
  for i in 1..16 loop
    insert into candidates (full_name, phone, email, current_title, current_employer, city, state, source, contact_consent, contact_consent_note, is_sample, notes, created_at, updated_at)
    values (names[i], '814-555-02' || lpad(i::text, 2, '0'), lower(replace(names[i], ' ', '.')) || '@example.com', titles[i], employers[i], towns[i], 'PA', srcs[i],
            i % 3 <> 0, case when i % 3 <> 0 then 'Applied on Indeed' end, true, 'Sample data', now() - (i * 3 || ' days')::interval, now() - (i || ' days')::interval)
    returning id into cj;
    cand := cand || cj;
  end loop;

  -- Pipeline: (candidate index, job, stage, days in stage)
  insert into candidate_jobs (candidate_id, job_id, stage, assigned_at, stage_changed_at, assigned_by)
  select cand[x.ci], x.j, x.st::pipeline_stage, now() - (x.d + 6 || ' days')::interval, now() - (x.d || ' days')::interval, me
  from (values
    (1, j1, 'interviewing', 2), (11, j1, 'submitted', 4), (15, j1, 'ready_to_submit', 1), (7, j1, 'contacting', 9), (13, j1, 'assigned', 0), (12, j1, 'passed', 12),
    (2, j2, 'conversation', 3), (9, j2, 'assigned', 1), (13, j2, 'contacting', 2),
    (3, j3, 'offer', 1), (5, j3, 'submitted', 8), (16, j3, 'conversation', 5), (14, j3, 'withdrawn', 20),
    (4, j4, 'interviewing', 6), (10, j4, 'ready_to_submit', 0), (8, j4, 'on_hold', 15)
  ) x(ci, j, st, d);

  -- A placement last month on the filled job, and one this month
  insert into candidate_jobs (candidate_id, job_id, stage, assigned_at, stage_changed_at, assigned_by)
  values (cand[6], j5, 'placed', now() - interval '60 days', now() - interval '38 days', me);
  update placements set start_date = current_date - 30, compensation = 64000, guarantee_until = current_date + 60, invoice_status = 'not_applicable'
  where candidate_job_id = (select id from candidate_jobs where candidate_id = cand[6] and job_id = j5);

  insert into jobs (title, company_id, market_id, location, compensation, priority, hiring_contact_id, opened_on, created_at, status) values
    ('Excavator Operator', c2, m, 'Brookville', '$28/hr', 2, p2, current_date - 50, now() - interval '50 days', 'filled') returning id into j5;
  insert into candidate_jobs (candidate_id, job_id, stage, assigned_at, stage_changed_at, assigned_by)
  values (cand[3], j5, 'placed', now() - interval '30 days', now() - interval '12 days', me);
  update placements set start_date = current_date - 5, compensation = 58240, fee_amount = 8736, guarantee_until = current_date + 85
  where candidate_job_id = (select id from candidate_jobs where candidate_id = cand[3] and job_id = j5);

  -- Stage history so the funnel report has numbers
  insert into activities (kind, summary, market_id, company_id, job_id, candidate_id, occurred_at, actor_id)
  select 'stage', 'Sample: moved → ' || s, m, c1, j1, cand[k], now() - (d || ' days')::interval, me
  from (values ('submitted',1,6),('interviewing',1,2),('submitted',11,4),('submitted',5,8),('submitted',4,12),('interviewing',4,6),
               ('submitted',3,9),('interviewing',3,5),('offer',3,1),('placed',3,12),('submitted',10,3)) x(s,k,d);

  insert into activities (kind, summary, market_id, candidate_id, occurred_at, actor_id)
  select k, t, m, cand[ci], now() - (d || ' hours')::interval, me
  from (values ('call','Talked through the 2nd shift schedule. Interested.',1,5),('text','Sent interview time for Thursday 10am.',1,26),
               ('call','Left voicemail.',7,50),('email','Sent job description.',2,70),('call','Wants $30/hr minimum.',3,100),
               ('note','Strong mechanical background, great attitude.',4,140),('call','Confirmed start date.',3,200),('text','Following up on offer.',16,30)) x(k,t,ci,d);

  -- Deals
  insert into deals (title, company_id, contact_id, market_id, stage, deal_type, value, expected_close, next_step, next_step_on, owner_id, created_at, stage_changed_at, notes) values
    ('DuBois Precision: 3-search subscription', c4, p4, m, 'proposal', 'subscription', 24000, current_date + 14, 'Follow up on proposal', current_date, me, now() - interval '20 days', now() - interval '4 days', 'Sample data'),
    ('Jefferson County CU: branch roles', c5, p5, m, 'meeting', 'contingency', 12000, current_date + 30, 'Intro meeting with Beth', current_date + 3, me, now() - interval '10 days', now() - interval '2 days', 'Sample data'),
    ('Allegheny Freight: CDL drivers', c6, p6, m, 'contacted', 'contingency', 18000, current_date + 45, 'Call Tom back', current_date - 2, me, now() - interval '15 days', now() - interval '12 days', 'Sample data'),
    ('Groundhog Health: renewal', c3, p3, m, 'lead', 'subscription', 12000, current_date + 25, 'Schedule renewal call', current_date + 7, me, now() - interval '3 days', now() - interval '3 days', 'Sample data');
  insert into deals (title, company_id, contact_id, market_id, stage, deal_type, value, owner_id, created_at, closed_at, notes) values
    ('Mahoning Valley: subscription', c1, p1, m, 'won', 'subscription', 24000, me, now() - interval '130 days', now() - interval '20 days', 'Sample data');

  insert into action_items (title, kind, priority, market_id, created_by, due_on, detail) values
    ('Send Dave the 2 CNC resumes', 'task', 1, m, me, current_date, 'Sample reminder');
end $$;
select (select count(*) from companies) co, (select count(*) from candidates) ca, (select count(*) from candidate_jobs) cj, (select count(*) from placements) pl, (select count(*) from deals) d, (select count(*) from needs_me) nm;
