CREATE TABLE IF NOT EXISTS prompts (
  prompt_id TEXT PRIMARY KEY,
  prompt_name TEXT NOT NULL,
  prompt_type TEXT NOT NULL,
  app_name TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  usecase_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  version_id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL REFERENCES prompts(prompt_id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  template_text TEXT NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  temperature NUMERIC,
  version_status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(prompt_id, version_number)
);

CREATE TABLE IF NOT EXISTS prompt_activations (
  activation_id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL REFERENCES prompts(prompt_id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES prompt_versions(version_id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  activated_by TEXT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_one_active
ON prompt_activations(prompt_id)
WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS prompt_evaluations (
  eval_id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL REFERENCES prompts(prompt_id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES prompt_versions(version_id) ON DELETE CASCADE,
  dataset_name TEXT,
  input_query TEXT,
  expected_tool TEXT,
  expected_keywords JSONB,
  actual_output TEXT,
  pass_fail BOOLEAN,
  score NUMERIC,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompts_scope
ON prompts(app_name, agent_type, usecase_name, prompt_type, environment);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt
ON prompt_versions(prompt_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_evals_prompt
ON prompt_evaluations(prompt_id, version_id);
