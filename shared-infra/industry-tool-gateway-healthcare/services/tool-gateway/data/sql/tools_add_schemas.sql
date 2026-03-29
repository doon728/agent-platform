-- Add input_schema and output_schema columns to tools table
-- These store the JSON schema contract for each tool.
-- Schema is defined first (in DB/UI), developer implements against it.

ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS input_schema  jsonb,
    ADD COLUMN IF NOT EXISTS output_schema jsonb;

-- Seed schemas for all 7 existing tools

UPDATE tools SET
    input_schema = '{
        "type": "object",
        "properties": {
            "query":     {"type": "string", "description": "Search query text"},
            "top_k":     {"type": "integer", "description": "Max number of results to return"},
            "threshold": {"type": "number",  "description": "Minimum similarity score (0-1)"}
        },
        "required": ["query"]
    }'::jsonb,
    output_schema = '{
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id":      {"type": "string"},
                        "title":   {"type": "string"},
                        "score":   {"type": "number"},
                        "snippet": {"type": "string"}
                    }
                }
            }
        }
    }'::jsonb
WHERE name = 'search_kb';


UPDATE tools SET
    input_schema = '{
        "type": "object",
        "properties": {
            "member_id": {"type": "string", "description": "Member ID e.g. m-000001"}
        },
        "required": ["member_id"]
    }'::jsonb,
    output_schema = '{
        "type": "object",
        "properties": {
            "member": {
                "type": ["object", "null"],
                "properties": {
                    "member_id":  {"type": "string"},
                    "first_name": {"type": "string"},
                    "last_name":  {"type": "string"},
                    "dob":        {"type": "string"},
                    "plan":       {"type": "string"}
                }
            }
        }
    }'::jsonb
WHERE name = 'get_member';


UPDATE tools SET
    input_schema = '{
        "type": "object",
        "properties": {
            "case_id": {"type": "string", "description": "Case ID or assessment ID"},
            "note":    {"type": "string", "description": "Note text to write"}
        },
        "required": ["case_id", "note"]
    }'::jsonb,
    output_schema = '{
        "type": "object",
        "properties": {
            "written": {"type": "boolean"},
            "note_id": {"type": ["string", "null"]}
        }
    }'::jsonb
WHERE name = 'write_case_note';


UPDATE tools SET
    input_schema = '{
        "type": "object",
        "properties": {
            "member_id": {"type": "string", "description": "Member ID e.g. m-000001"}
        },
        "required": ["member_id"]
    }'::jsonb,
    output_schema = '{
        "type": "object",
        "properties": {
            "found":     {"type": "boolean"},
            "member_id": {"type": "string"},
            "data":      {"type": ["object", "null"], "description": "Full member profile including care plans, assessments, claims, auths"}
        }
    }'::jsonb
WHERE name = 'get_member_summary';


UPDATE tools SET
    input_schema = '{
        "type": "object",
        "properties": {
            "assessment_id": {"type": "string", "description": "Assessment ID e.g. asmt-000001"}
        },
        "required": ["assessment_id"]
    }'::jsonb,
    output_schema = '{
        "type": "object",
        "properties": {
            "found":         {"type": "boolean"},
            "assessment_id": {"type": "string"},
            "data":          {"type": ["object", "null"], "description": "Full assessment including responses, flagged answers, recent case notes"}
        }
    }'::jsonb
WHERE name = 'get_assessment_summary';


UPDATE tools SET
    input_schema = '{
        "type": "object",
        "properties": {
            "assessment_id": {"type": "string", "description": "Assessment ID e.g. asmt-000001"}
        },
        "required": ["assessment_id"]
    }'::jsonb,
    output_schema = '{
        "type": "object",
        "properties": {
            "found":         {"type": "boolean"},
            "assessment_id": {"type": "string"},
            "tasks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "task_id":  {"type": "string"},
                        "phase":    {"type": "string"},
                        "title":    {"type": "string"},
                        "status":   {"type": "string"},
                        "due_date": {"type": ["string", "null"]}
                    }
                }
            }
        }
    }'::jsonb
WHERE name = 'get_assessment_tasks';


UPDATE tools SET
    input_schema = '{
        "type": "object",
        "properties": {
            "case_id": {"type": "string", "description": "Case ID e.g. case-001"}
        },
        "required": ["case_id"]
    }'::jsonb,
    output_schema = '{
        "type": "object",
        "properties": {
            "found":   {"type": "boolean"},
            "case_id": {"type": "string"},
            "data":    {"type": ["object", "null"], "description": "Full case including member profile, assessments, recent case notes"}
        }
    }'::jsonb
WHERE name = 'get_case_summary';
