-- Add status column to tools table
-- draft   = registered in DB, schema defined, handler not written yet
-- active  = handler deployed, route mounted, ready for agents to use
-- disabled = manually turned off

ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Existing tools are already working — mark them active
UPDATE tools SET status = 'active';
