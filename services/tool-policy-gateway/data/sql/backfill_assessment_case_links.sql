-- Backfill assessments.case_id by distributing each member's assessments round-robin
-- across the cases that belong to that member.
--
-- Why this exists:
--   The seed CSV (assessments.csv) has no case_id column, so after COPY every row has
--   case_id = NULL. The DB schema added case_id later but synthetic data was never updated.
--   Without this backfill, queries like "show assessments for case X" return zero rows,
--   even though assessments exist for the case's member.
--
-- Idempotent: only updates rows where case_id IS NULL. Safe to re-run.

WITH ranked_assessments AS (
  SELECT
    assessment_id,
    member_id,
    ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY created_at, assessment_id) AS rn
  FROM assessments
  WHERE case_id IS NULL
),
member_cases AS (
  SELECT
    member_id,
    case_id,
    ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY open_date, case_id) AS case_idx,
    COUNT(*) OVER (PARTITION BY member_id) AS total_cases
  FROM cases
)
UPDATE assessments a
SET case_id = mc.case_id
FROM ranked_assessments ra
JOIN member_cases mc
  ON mc.member_id = ra.member_id
 AND mc.case_idx = ((ra.rn - 1) % mc.total_cases) + 1
WHERE a.assessment_id = ra.assessment_id
  AND a.member_id = ra.member_id
  AND a.case_id IS NULL;
