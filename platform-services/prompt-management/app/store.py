from typing import List, Optional
from uuid import uuid4
import json

from app.db import get_conn


def get_prompt_by_id(prompt_id: str) -> Optional[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              p.prompt_id,
              p.prompt_name,
              p.capability_name,
              p.usecase_name,
              p.agent_type,
              p.prompt_type,
              p.environment,
              p.lifecycle_status,
              p.created_at,
              p.updated_at,
              COALESCE(pv_active.version_id, pv_latest.version_id) AS version_id,
              COALESCE(pv_active.version_number, pv_latest.version_number) AS version,
              COALESCE(pv_active.template_text, pv_latest.template_text) AS template_text,
              COALESCE(pv_active.model_provider, pv_latest.model_provider) AS model_provider,
              COALESCE(pv_active.model_name, pv_latest.model_name) AS model_name,
              COALESCE(pv_active.temperature, pv_latest.temperature) AS temperature,
              COALESCE(pv_active.version_status, pv_latest.version_status) AS version_status,
              COALESCE(pa.is_active, FALSE) AS is_active
            FROM prompts p
            LEFT JOIN prompt_activations pa
              ON pa.prompt_id = p.prompt_id
             AND pa.is_active = TRUE
            LEFT JOIN prompt_versions pv_active
              ON pv_active.version_id = pa.version_id
            LEFT JOIN LATERAL (
              SELECT * FROM prompt_versions
              WHERE prompt_id = p.prompt_id
              ORDER BY version_number DESC
              LIMIT 1
            ) pv_latest ON TRUE
            WHERE p.prompt_id = %s
            """,
            (prompt_id,),
        )
        return cur.fetchone()


def list_prompts() -> List[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              p.prompt_id,
              p.prompt_name,
              p.capability_name,
              p.usecase_name,
              p.agent_type,
              p.prompt_type,
              p.environment,
              p.lifecycle_status,
              p.created_at,
              p.updated_at,
              pa.version_id AS active_version_id
            FROM prompts p
            LEFT JOIN prompt_activations pa
              ON pa.prompt_id = p.prompt_id
             AND pa.is_active = TRUE
            ORDER BY p.created_at DESC
            """
        )
        return cur.fetchall()


def create_prompt_with_version(record: dict) -> dict:
    prompt_id = record["prompt_id"]
    version_id = f"ver-{uuid4().hex[:10]}"

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO prompts (
              prompt_id,
              prompt_name,
              capability_name,
              usecase_name,
              agent_type,
              prompt_type,
              environment,
              lifecycle_status,
              created_by,
              created_at,
              updated_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                prompt_id,
                record["prompt_name"],
                record["capability_name"],
                record["usecase_name"],
                record["agent_type"],
                record["prompt_type"],
                record["environment"],
                record["lifecycle_status"],
                "platform_user",
                record["created_at"],
                record["updated_at"],
            ),
        )

        cur.execute(
            """
            INSERT INTO prompt_versions (
              version_id,
              prompt_id,
              version_number,
              template_text,
              model_provider,
              model_name,
              temperature,
              version_status,
              created_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            """,
            (
                version_id,
                prompt_id,
                record["version"],
                record["template_text"],
                record.get("model_provider"),
                record.get("model_name"),
                record.get("temperature"),
                record["version_status"],
            ),
        )

        if (
            record["is_active"]
            and record["version_status"] == "approved"
            and record["lifecycle_status"] == "active"
        ):
            cur.execute(
                "UPDATE prompt_activations SET is_active = FALSE WHERE prompt_id = %s",
                (prompt_id,),
            )
            cur.execute(
                """
                INSERT INTO prompt_activations (
                  activation_id,
                  prompt_id,
                  version_id,
                  is_active,
                  activated_by
                ) VALUES (%s,%s,%s,TRUE,%s)
                """,
                (f"act-{uuid4().hex[:10]}", prompt_id, version_id, "platform_user"),
            )

        conn.commit()

    return {**record, "version_id": version_id}


def resolve_active_prompt(
    capability_name: str,
    usecase_name: str,
    agent_type: str,
    prompt_type: str,
    environment: str,
) -> Optional[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              p.prompt_id,
              p.prompt_name,
              p.capability_name,
              p.usecase_name,
              p.agent_type,
              p.prompt_type,
              p.environment,
              p.lifecycle_status,
              pv.version_id,
              pv.version_number AS version,
              pv.template_text,
              pv.model_provider,
              pv.model_name,
              pv.temperature,
              pv.version_status,
              TRUE AS is_active
            FROM prompts p
            JOIN prompt_activations pa
              ON pa.prompt_id = p.prompt_id
             AND pa.is_active = TRUE
            JOIN prompt_versions pv
              ON pv.version_id = pa.version_id
            WHERE p.capability_name = %s
              AND p.usecase_name = %s
              AND p.agent_type = %s
              AND p.prompt_type = %s
              AND p.environment = %s
              AND p.lifecycle_status = 'active'
              AND pv.version_status = 'approved'
            ORDER BY pv.version_number DESC
            LIMIT 1
            """,
            (capability_name, usecase_name, agent_type, prompt_type, environment),
        )
        return cur.fetchone()


def append_eval(record: dict) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO prompt_evaluations (
              eval_id,
              prompt_id,
              version_id,
              dataset_name,
              input_query,
              expected_tool,
              expected_keywords,
              actual_output,
              pass_fail,
              score,
              latency_ms
            ) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
            """,
            (
                record["eval_id"],
                record["prompt_id"],
                record.get("version_id"),
                "manual_eval",
                record["input_query"],
                record.get("expected_tool"),
                json.dumps(record.get("expected_keywords", [])),
                record["actual_output"],
                record["pass_fail"],
                record["score"],
                None,
            ),
        )
        conn.commit()


def approve_prompt_version(prompt_id: str, version_number: int) -> Optional[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE prompt_versions
               SET version_status = 'approved'
             WHERE prompt_id = %s
               AND version_number = %s
         RETURNING *
            """,
            (prompt_id, version_number),
        )
        row = cur.fetchone()
        if not row:
            return None
        conn.commit()
        return row


def activate_prompt_version(prompt_id: str, version_number: int) -> Optional[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT version_id, version_status
              FROM prompt_versions
             WHERE prompt_id = %s
               AND version_number = %s
            """,
            (prompt_id, version_number),
        )
        version_row = cur.fetchone()
        if not version_row:
            return None

        if version_row["version_status"] != "approved":
            return {"error": "version_not_approved"}

        version_id = version_row["version_id"]

        cur.execute(
            """
            UPDATE prompt_activations
               SET is_active = FALSE
             WHERE prompt_id = %s
               AND is_active = TRUE
            """,
            (prompt_id,),
        )

        cur.execute(
            """
            INSERT INTO prompt_activations (
              activation_id,
              prompt_id,
              version_id,
              is_active,
              activated_by
            ) VALUES (%s, %s, %s, TRUE, %s)
            RETURNING *
            """,
            (f"act-{uuid4().hex[:10]}", prompt_id, version_id, "platform_user"),
        )
        activation_row = cur.fetchone()

        cur.execute(
            """
            UPDATE prompts
               SET lifecycle_status = 'active',
                   updated_at = NOW()
             WHERE prompt_id = %s
            """,
            (prompt_id,),
        )

        conn.commit()
        return activation_row