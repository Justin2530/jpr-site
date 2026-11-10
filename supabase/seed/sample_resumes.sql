-- Text resumes for the sample candidates, so the resume viewer has something to show.
with skills(title, s) as (values
 ('HR Generalist', array['Onboarding and benefits enrollment for 400+ employees','Maintained HRIS records and payroll changes','Scheduled interviews and coordinated front-office staff']),
 ('Office Manager', array['Ran a 12-person branch office: scheduling, vendors, supplies','Accounts payable and month-end reconciliation','Trained new staff on front-desk procedures']),
 ('Welder', array['MIG and flux-core on structural steel','Reads blueprints and weld symbols','Operates overhead crane and forklift']),
 ('Heavy Equipment Operator', array['Excavator, dozer and loader on site-prep and utility jobs','Grade checking with laser and GPS','Daily equipment inspections and minor maintenance']),
 ('Forklift Operator', array['Sit-down and reach forklift, 6 years, OSHA certified','Cycle counts and inventory in WMS','Set up and ran a small manual lathe in a previous job']),
 ('Staff Accountant', array['GL reconciliations and month-end close','AP/AR for multi-location clients','QuickBooks and Excel (pivot tables, lookups)']),
 ('CDL-A Driver', array['Regional flatbed, clean MVR','Load securement and DOT logs','Forklift loading at customer docks']),
 ('Mechanic', array['Diagnostics and repair on light and medium trucks','Hydraulics and electrical troubleshooting','Welding and fabrication for repairs']),
 ('Production Supervisor', array['Led 25 operators across two shifts','Scheduling, safety and quality metrics','Injection molding changeovers']),
 ('CNC Machinist', array['Setup and operation of Haas and Mazak mills and lathes','Fanuc controls, G-code edits at the machine','First-article inspection with mics, calipers, height gauge']),
 ('Quality Inspector', array['CMM and hand-gauge inspection','Reads GD&T drawings','Writes nonconformance reports']),
 ('Payroll Specialist', array['Biweekly payroll for 300 employees','Timekeeping audits','Garnishments and benefits deductions']),
 ('Electrician', array['Industrial wiring, motor controls and VFDs','PLC troubleshooting (Allen-Bradley)','Conduit bending and panel work']),
 ('Plant Manager', array['P&L for a 60-person foundry','Lean projects and safety program','Hiring and training supervisors']),
 ('Maintenance Tech', array['Preventive maintenance on packaging and CNC equipment','Hydraulics, pneumatics, basic PLC','Welding and fabrication']),
 ('Machine Operator', array['Runs CNC lathes on production parts','Tool changes and offsets','In-process inspection with micrometers']))
insert into resumes (candidate_id, file_name, mime_type, text_content, created_at)
select c.id, replace(c.full_name, ' ', '_') || '_Resume.txt', 'text/plain',
  upper(c.full_name) || E'\n' || c.city || ', PA · ' || c.email || E'\n\nSUMMARY\n' ||
  c.current_title || E' with hands-on experience in the region. Reliable, safety-minded, looking for steady work close to home.\n\nEXPERIENCE\n' ||
  c.current_title || ' · ' || c.current_employer || E' · 2019 to present\n' ||
  (select string_agg('  • ' || x, E'\n') from unnest(k.s) x) ||
  E'\n\nPrevious role · ' || c.city || E' area employer · 2014 to 2019\n  • General production and warehouse work\n  • Perfect attendance award, 2017\n\nEDUCATION\nPunxsutawney Area High School · Diploma\nJeff Tech · Continuing education courses\n\nCERTIFICATIONS\nOSHA 10\n\n(Sample resume)',
  now() - interval '9 days'
from candidates c join skills k on k.title = c.current_title
where c.is_sample and not exists (select 1 from resumes r where r.candidate_id = c.id);
