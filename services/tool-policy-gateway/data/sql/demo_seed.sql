-- Demo seed: link existing assessments to cases and insert demo assessments/tasks/care_plans

-- Link asmt-000001 to case-001
UPDATE assessments SET case_id = 'case-001' WHERE assessment_id = 'asmt-000001';

-- Insert demo assessments for Mia Martinez (m-001715)
INSERT INTO assessments (assessment_id, member_id, case_id, care_plan_id, assessment_type, status, priority, created_at, completed_at, overall_risk_level, summary)
VALUES
  ('asmt-d002', 'm-001715', 'case-001', NULL,       'Follow-up',    'ACTIVE',    'MEDIUM', '2026-03-01', NULL,         'MEDIUM', 'Follow-up assessment for asthma management. Member reported improvement with inhaler.'),
  ('asmt-d003', 'm-001715', 'case-001', NULL,       'Reassessment', 'SCHEDULED', 'LOW',    '2026-04-01', NULL,         NULL,     'Scheduled reassessment for Q2.'),
  ('asmt-d004', 'm-001715', 'case-002', 'cp-d001',  'Discharge',    'COMPLETE',  'HIGH',   '2025-11-05', '2025-11-20', 'HIGH',   'Post-discharge assessment. Member stabilized. Medication plan updated.'),
  ('asmt-d005', 'm-001715', 'case-002', 'cp-d001',  '30-Day',       'COMPLETE',  'MEDIUM', '2025-12-01', '2025-12-10', 'MEDIUM', '30-day follow-up post discharge. Member adherent to medications.'),
  ('asmt-d006', 'm-001715', 'case-003', NULL,       'Initial',      'ACTIVE',    'HIGH',   '2026-02-22', NULL,         'HIGH',   'Initial behavioral health assessment. Member expressing depressive symptoms.')
ON CONFLICT (assessment_id) DO NOTHING;

-- Insert demo assessments for Carlos Rivera (m-001234)
INSERT INTO assessments (assessment_id, member_id, case_id, care_plan_id, assessment_type, status, priority, created_at, completed_at, overall_risk_level, summary)
VALUES
  ('asmt-d007', 'm-001234', 'case-004', 'cp-d002',  'Pre-Call',     'COMPLETE',  'MEDIUM', '2026-01-18', '2026-01-25', 'MEDIUM', 'Pre-call assessment for diabetes management. A1c elevated at 8.2.'),
  ('asmt-d008', 'm-001234', 'case-004', NULL,        'Quarterly',    'ACTIVE',    'MEDIUM', '2026-02-15', NULL,         'MEDIUM', 'Quarterly review. Member struggling with diet adherence.'),
  ('asmt-d009', 'm-001234', 'case-005', 'cp-d003',  'Initial',      'COMPLETE',  'LOW',    '2026-02-05', '2026-02-12', 'LOW',    'Initial hypertension assessment. BP controlled on current medication.')
ON CONFLICT (assessment_id) DO NOTHING;

-- Insert demo assessments for Dorothy Chen (m-000891)
INSERT INTO assessments (assessment_id, member_id, case_id, care_plan_id, assessment_type, status, priority, created_at, completed_at, overall_risk_level, summary)
VALUES
  ('asmt-d010', 'm-000891', 'case-006', 'cp-d004',  'Pre-Call',     'COMPLETE',  'HIGH',   '2026-01-22', '2026-01-28', 'HIGH',   'Pre-call CHF assessment. Member reports shortness of breath and leg swelling.'),
  ('asmt-d011', 'm-000891', 'case-006', NULL,        'Monthly',      'ACTIVE',    'HIGH',   '2026-02-28', NULL,         'HIGH',   'Monthly CHF check-in. Weight gain noted. Medication adjusted.')
ON CONFLICT (assessment_id) DO NOTHING;

-- Insert demo care plans
INSERT INTO care_plans (care_plan_id, member_id, program, start_date, status, goals)
VALUES
  ('cp-d001', 'm-001715', 'PostDischarge',   '2025-11-20', 'CLOSED',  'Stabilize post-discharge; ensure medication adherence; schedule PCP follow-up.'),
  ('cp-d002', 'm-001234', 'Diabetes',        '2026-01-25', 'ACTIVE',  'Improve A1c to below 7.5; dietary counseling; monthly check-ins.'),
  ('cp-d003', 'm-001234', 'Hypertension',    '2026-02-12', 'ACTIVE',  'Maintain BP below 130/80; medication adherence; reduce sodium intake.'),
  ('cp-d004', 'm-000891', 'CHF',             '2026-01-28', 'ACTIVE',  'Daily weight monitoring; fluid restriction; cardiology follow-up bi-weekly.')
ON CONFLICT (care_plan_id) DO NOTHING;

-- Insert tasks for asmt-000001 (Mia / case-001 / Pre-Call)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-001', 'asmt-000001', 'case-001', 'm-001715', 'pre_call',    'Review member history',         'COMPLETE', '2026-03-10'),
  ('task-002', 'asmt-000001', 'case-001', 'm-001715', 'pre_call',    'Verify contact information',    'COMPLETE', '2026-03-10'),
  ('task-003', 'asmt-000001', 'case-001', 'm-001715', 'pre_call',    'Write pre-call note',           'COMPLETE', '2026-03-10'),
  ('task-004', 'asmt-000001', 'case-001', 'm-001715', 'during_call', 'Complete questionnaire',        'OPEN',     '2026-03-11'),
  ('task-005', 'asmt-000001', 'case-001', 'm-001715', 'during_call', 'Document member responses',     'OPEN',     '2026-03-11'),
  ('task-006', 'asmt-000001', 'case-001', 'm-001715', 'during_call', 'Flag clinical concerns',        'OPEN',     '2026-03-11'),
  ('task-007', 'asmt-000001', 'case-001', 'm-001715', 'post_call',   'Write case note',               'COMPLETE', '2026-03-12'),
  ('task-008', 'asmt-000001', 'case-001', 'm-001715', 'post_call',   'Schedule follow-up',            'OPEN',     '2026-03-15'),
  ('task-009', 'asmt-000001', 'case-001', 'm-001715', 'post_call',   'Create care plan',              'OPEN',     '2026-03-20')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d002 (Mia / case-001 / Follow-up)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-010', 'asmt-d002', 'case-001', 'm-001715', 'pre_call',    'Review prior notes',            'COMPLETE', '2026-03-01'),
  ('task-011', 'asmt-d002', 'case-001', 'm-001715', 'pre_call',    'Check medication list',         'OPEN',     '2026-03-01'),
  ('task-012', 'asmt-d002', 'case-001', 'm-001715', 'during_call', 'Complete questionnaire',        'OPEN',     '2026-03-05'),
  ('task-013', 'asmt-d002', 'case-001', 'm-001715', 'post_call',   'Write case note',               'OPEN',     '2026-03-06'),
  ('task-014', 'asmt-d002', 'case-001', 'm-001715', 'post_call',   'Update care plan',              'OPEN',     '2026-03-10')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d007 (Carlos / case-004 / Pre-Call)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-020', 'asmt-d007', 'case-004', 'm-001234', 'pre_call',    'Review diabetes history',       'COMPLETE', '2026-01-18'),
  ('task-021', 'asmt-d007', 'case-004', 'm-001234', 'pre_call',    'Check A1c and lab results',     'COMPLETE', '2026-01-18'),
  ('task-022', 'asmt-d007', 'case-004', 'm-001234', 'during_call', 'Complete questionnaire',        'COMPLETE', '2026-01-22'),
  ('task-023', 'asmt-d007', 'case-004', 'm-001234', 'post_call',   'Write case note',               'COMPLETE', '2026-01-23'),
  ('task-024', 'asmt-d007', 'case-004', 'm-001234', 'post_call',   'Create care plan',              'COMPLETE', '2026-01-25')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d010 (Dorothy / case-006 / Pre-Call)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-030', 'asmt-d010', 'case-006', 'm-000891', 'pre_call',    'Review CHF history',            'COMPLETE', '2026-01-22'),
  ('task-031', 'asmt-d010', 'case-006', 'm-000891', 'pre_call',    'Check weight and vitals',       'COMPLETE', '2026-01-22'),
  ('task-032', 'asmt-d010', 'case-006', 'm-000891', 'during_call', 'Complete questionnaire',        'COMPLETE', '2026-01-25'),
  ('task-033', 'asmt-d010', 'case-006', 'm-000891', 'post_call',   'Write case note',               'COMPLETE', '2026-01-26'),
  ('task-034', 'asmt-d010', 'case-006', 'm-000891', 'post_call',   'Create care plan',              'COMPLETE', '2026-01-28'),
  ('task-035', 'asmt-d010', 'case-006', 'm-000891', 'post_call',   'Schedule cardiology follow-up', 'OPEN',     '2026-02-01')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d003 (Mia / case-001 / Reassessment / SCHEDULED)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-040', 'asmt-d003', 'case-001', 'm-001715', 'pre_call',    'Review Q1 progress notes',       'OPEN', '2026-04-01'),
  ('task-041', 'asmt-d003', 'case-001', 'm-001715', 'pre_call',    'Update medication list',          'OPEN', '2026-04-01'),
  ('task-042', 'asmt-d003', 'case-001', 'm-001715', 'during_call', 'Complete reassessment survey',    'OPEN', '2026-04-05'),
  ('task-043', 'asmt-d003', 'case-001', 'm-001715', 'post_call',   'Write case note',                 'OPEN', '2026-04-06'),
  ('task-044', 'asmt-d003', 'case-001', 'm-001715', 'post_call',   'Update care plan',                'OPEN', '2026-04-10')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d004 (Mia / case-002 / Discharge / COMPLETE)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-050', 'asmt-d004', 'case-002', 'm-001715', 'pre_call',    'Review discharge summary',       'COMPLETE', '2025-11-05'),
  ('task-051', 'asmt-d004', 'case-002', 'm-001715', 'pre_call',    'Confirm medication changes',     'COMPLETE', '2025-11-05'),
  ('task-052', 'asmt-d004', 'case-002', 'm-001715', 'during_call', 'Complete discharge assessment',  'COMPLETE', '2025-11-10'),
  ('task-053', 'asmt-d004', 'case-002', 'm-001715', 'post_call',   'Write case note',                'COMPLETE', '2025-11-12'),
  ('task-054', 'asmt-d004', 'case-002', 'm-001715', 'post_call',   'Create post-discharge plan',     'COMPLETE', '2025-11-20')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d005 (Mia / case-002 / 30-Day / COMPLETE)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-060', 'asmt-d005', 'case-002', 'm-001715', 'pre_call',    'Review 30-day progress',         'COMPLETE', '2025-12-01'),
  ('task-061', 'asmt-d005', 'case-002', 'm-001715', 'during_call', 'Complete 30-day survey',         'COMPLETE', '2025-12-05'),
  ('task-062', 'asmt-d005', 'case-002', 'm-001715', 'post_call',   'Write case note',                'COMPLETE', '2025-12-10')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d006 (Mia / case-003 / Initial Behavioral / ACTIVE)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-070', 'asmt-d006', 'case-003', 'm-001715', 'pre_call',    'Review behavioral health history','COMPLETE', '2026-02-22'),
  ('task-071', 'asmt-d006', 'case-003', 'm-001715', 'pre_call',    'Verify current medications',     'COMPLETE', '2026-02-22'),
  ('task-072', 'asmt-d006', 'case-003', 'm-001715', 'during_call', 'Complete PHQ-9 assessment',      'OPEN',     '2026-03-01'),
  ('task-073', 'asmt-d006', 'case-003', 'm-001715', 'during_call', 'Document symptoms and triggers', 'OPEN',     '2026-03-01'),
  ('task-074', 'asmt-d006', 'case-003', 'm-001715', 'post_call',   'Write case note',                'OPEN',     '2026-03-02'),
  ('task-075', 'asmt-d006', 'case-003', 'm-001715', 'post_call',   'Refer to behavioral health',     'OPEN',     '2026-03-05')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d008 (Carlos / case-004 / Quarterly / ACTIVE)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-080', 'asmt-d008', 'case-004', 'm-001234', 'pre_call',    'Pull latest A1c results',        'COMPLETE', '2026-02-15'),
  ('task-081', 'asmt-d008', 'case-004', 'm-001234', 'pre_call',    'Review diet log',                'OPEN',     '2026-02-15'),
  ('task-082', 'asmt-d008', 'case-004', 'm-001234', 'during_call', 'Complete quarterly survey',      'OPEN',     '2026-02-20'),
  ('task-083', 'asmt-d008', 'case-004', 'm-001234', 'post_call',   'Write case note',                'OPEN',     '2026-02-21'),
  ('task-084', 'asmt-d008', 'case-004', 'm-001234', 'post_call',   'Update diabetes care plan',      'OPEN',     '2026-02-25')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d009 (Carlos / case-005 / Initial Hypertension / COMPLETE)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-090', 'asmt-d009', 'case-005', 'm-001234', 'pre_call',    'Review BP history',               'COMPLETE', '2026-02-05'),
  ('task-091', 'asmt-d009', 'case-005', 'm-001234', 'during_call', 'Complete hypertension assessment', 'COMPLETE', '2026-02-08'),
  ('task-092', 'asmt-d009', 'case-005', 'm-001234', 'post_call',   'Write case note',                 'COMPLETE', '2026-02-10'),
  ('task-093', 'asmt-d009', 'case-005', 'm-001234', 'post_call',   'Create hypertension care plan',   'COMPLETE', '2026-02-12')
ON CONFLICT (task_id) DO NOTHING;

-- Tasks for asmt-d011 (Dorothy / case-006 / Monthly CHF / ACTIVE)
INSERT INTO tasks (task_id, assessment_id, case_id, member_id, phase, title, status, due_date)
VALUES
  ('task-100', 'asmt-d011', 'case-006', 'm-000891', 'pre_call',    'Review weight log',              'COMPLETE', '2026-02-28'),
  ('task-101', 'asmt-d011', 'case-006', 'm-000891', 'pre_call',    'Check fluid restriction notes',  'COMPLETE', '2026-02-28'),
  ('task-102', 'asmt-d011', 'case-006', 'm-000891', 'during_call', 'Complete monthly CHF survey',    'OPEN',     '2026-03-05'),
  ('task-103', 'asmt-d011', 'case-006', 'm-000891', 'during_call', 'Document weight and symptoms',   'OPEN',     '2026-03-05'),
  ('task-104', 'asmt-d011', 'case-006', 'm-000891', 'post_call',   'Write case note',                'OPEN',     '2026-03-06'),
  ('task-105', 'asmt-d011', 'case-006', 'm-000891', 'post_call',   'Adjust medication per protocol', 'OPEN',     '2026-03-07')
ON CONFLICT (task_id) DO NOTHING;
