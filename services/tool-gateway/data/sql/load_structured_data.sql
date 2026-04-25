TRUNCATE TABLE
  tasks,
  cases,
  assessment_responses,
  assessment_questions,
  assessments,
  auths,
  care_plans,
  case_notes,
  claims,
  members,
  providers
RESTART IDENTITY;

\copy assessment_questions FROM '/tmp/assessment_questions.csv' WITH (FORMAT csv, HEADER true)
\copy assessment_responses FROM '/tmp/assessment_responses.csv' WITH (FORMAT csv, HEADER true)
\copy assessments(assessment_id,member_id,care_plan_id,assessment_type,status,priority,created_at,completed_at,overall_risk_level,summary) FROM '/tmp/assessments.csv' WITH (FORMAT csv, HEADER true)
\copy auths                FROM '/tmp/auths.csv'                WITH (FORMAT csv, HEADER true)
\copy care_plans           FROM '/tmp/care_plans.csv'           WITH (FORMAT csv, HEADER true)
\copy case_notes           FROM '/tmp/case_notes.csv'           WITH (FORMAT csv, HEADER true)
\copy claims               FROM '/tmp/claims.csv'               WITH (FORMAT csv, HEADER true)
\copy members              FROM '/tmp/members.csv'              WITH (FORMAT csv, HEADER true)
\copy providers            FROM '/tmp/providers.csv'            WITH (FORMAT csv, HEADER true)
\copy cases                FROM '/tmp/cases.csv'                WITH (FORMAT csv, HEADER true)
