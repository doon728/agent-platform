CREATE TABLE IF NOT EXISTS members (
  member_id text PRIMARY KEY,
  first_name text,
  last_name text,
  dob date,
  gender text,
  state text,
  plan_id text,
  pcp_provider_id text,
  risk_score numeric,
  chronic_conditions text,
  address_zip text
);

CREATE TABLE IF NOT EXISTS providers (
  provider_id text PRIMARY KEY,
  npi text,
  provider_name text,
  specialty text,
  state text,
  network_status text,
  phone text
);

CREATE TABLE IF NOT EXISTS care_plans (
  care_plan_id text PRIMARY KEY,
  member_id text,
  program text,
  start_date date,
  status text,
  goals text
);

CREATE TABLE IF NOT EXISTS assessments (
  assessment_id text PRIMARY KEY,
  member_id text,
  care_plan_id text,
  assessment_type text,
  status text,
  priority text,
  created_at date,
  completed_at date,
  overall_risk_level text,
  summary text
);

CREATE TABLE IF NOT EXISTS assessment_questions (
  question_id text PRIMARY KEY,
  domain text,
  question_text text,
  answer_type text
);

CREATE TABLE IF NOT EXISTS assessment_responses (
  response_id text PRIMARY KEY,
  assessment_id text,
  question_id text,
  answer_value text,
  flag_risk text,
  answered_at timestamptz
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id text PRIMARY KEY,
  member_id text,
  provider_id text,
  service_from_date date,
  service_to_date date,
  claim_type text,
  total_amount numeric,
  paid_amount numeric,
  status text,
  diagnosis_codes text,
  procedure_codes text
);

CREATE TABLE IF NOT EXISTS auths (
  auth_id text PRIMARY KEY,
  member_id text,
  requesting_provider_id text,
  request_date date,
  service_type text,
  status text,
  decision_date date,
  diagnosis_codes text,
  notes_summary text
);

CREATE TABLE IF NOT EXISTS case_notes (
  note_id text PRIMARY KEY,
  member_id text,
  assessment_id text,
  author text,
  created_at timestamptz,
  note_text text
);

CREATE INDEX IF NOT EXISTS idx_care_plans_member_id ON care_plans(member_id);
CREATE INDEX IF NOT EXISTS idx_assessments_member_id ON assessments(member_id);
CREATE INDEX IF NOT EXISTS idx_assessments_care_plan_id ON assessments(care_plan_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_assessment_id ON assessment_responses(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_question_id ON assessment_responses(question_id);
CREATE INDEX IF NOT EXISTS idx_claims_member_id ON claims(member_id);
CREATE INDEX IF NOT EXISTS idx_auths_member_id ON auths(member_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_assessment_id ON case_notes(assessment_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_member_id ON case_notes(member_id);
