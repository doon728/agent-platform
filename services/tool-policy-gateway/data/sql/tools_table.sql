-- Tool registry table
-- Gateway loads this at startup instead of the hardcoded TOOL_REGISTRY dict.
-- endpoint_url is where the gateway POSTs the invocation payload.
-- For dev: points at internal routes on this same service (e.g. /internal/tools/search_kb).
-- For production: points at real backend URLs (Lambda, Epic, Pega, etc.).

CREATE TABLE IF NOT EXISTS tools (
    name            text PRIMARY KEY,
    description     text NOT NULL,
    endpoint_url    text NOT NULL,
    primary_arg     text NOT NULL DEFAULT 'query',
    mode            text NOT NULL DEFAULT 'read',   -- 'read' | 'write'
    tags            text[] NOT NULL DEFAULT '{}',
    db_type         text,       -- 'vector_db' | 'relational' | 'graph_db' | null
    strategy        text,       -- 'semantic' | 'hybrid' | 'keyword' | null
    enabled         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed existing tools
-- endpoint_url points at /internal/tools/<name> on this same service (dev handlers)

INSERT INTO tools (name, description, endpoint_url, primary_arg, mode, tags, db_type, strategy)
VALUES
(
    'search_kb',
    'Search the knowledge base for relevant documents.',
    'http://localhost:8080/internal/tools/search_kb',
    'query',
    'read',
    ARRAY['retrieval', 'knowledge', 'policy', 'care_management'],
    'vector_db',
    'semantic'
),
(
    'get_member',
    'Fetch a member record by member_id.',
    'http://localhost:8080/internal/tools/get_member',
    'member_id',
    'read',
    ARRAY['member', 'lookup', 'care_management'],
    NULL,
    NULL
),
(
    'write_case_note',
    'Write a note to a case record.',
    'http://localhost:8080/internal/tools/write_case_note',
    'note',
    'write',
    ARRAY['case', 'notes', 'write', 'care_management'],
    NULL,
    NULL
),
(
    'get_member_summary',
    'Return member profile + care plans + latest assessment + recent claims/auths.',
    'http://localhost:8080/internal/tools/get_member_summary',
    'member_id',
    'read',
    ARRAY['member', 'summary', 'care_management'],
    NULL,
    NULL
),
(
    'get_assessment_summary',
    'Return assessment(case) + responses + flagged answers + recent case notes.',
    'http://localhost:8080/internal/tools/get_assessment_summary',
    'assessment_id',
    'read',
    ARRAY['assessment', 'summary', 'case', 'care_management'],
    NULL,
    NULL
),
(
    'get_assessment_tasks',
    'Return all tasks (pre_call, during_call, post_call) for an assessment with their status.',
    'http://localhost:8080/internal/tools/get_assessment_tasks',
    'assessment_id',
    'read',
    ARRAY['assessment', 'tasks', 'care_management'],
    NULL,
    NULL
),
(
    'get_case_summary',
    'Return case details + member profile + assessments + recent case notes for a specific case.',
    'http://localhost:8080/internal/tools/get_case_summary',
    'case_id',
    'read',
    ARRAY['case', 'summary', 'care_management'],
    NULL,
    NULL
)
ON CONFLICT (name) DO NOTHING;
