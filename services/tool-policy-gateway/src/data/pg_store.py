from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import psycopg

DB_HOST = os.getenv("KB_PG_HOST", "host.docker.internal")
DB_PORT = int(os.getenv("KB_PG_PORT", "5432"))
DB_NAME = os.getenv("KB_PG_DB", "agentdb")
DB_USER = os.getenv("KB_PG_USER", "postgres")
DB_PASSWORD = os.getenv("KB_PG_PASSWORD", "postgres")


def _conn():
    return psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


class PGStore:
    def get_member_summary(self, member_id: str) -> Dict[str, Any]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT member_id, first_name, last_name, dob::text, gender, state, plan_id,
                           pcp_provider_id, risk_score::text, chronic_conditions, address_zip
                    FROM members
                    WHERE member_id = %s
                    """,
                    (member_id,),
                )
                row = cur.fetchone()

                if not row:
                    return {"found": False, "member_id": member_id}

                member = {
                    "member_id": row[0],
                    "first_name": row[1],
                    "last_name": row[2],
                    "dob": row[3],
                    "gender": row[4],
                    "state": row[5],
                    "plan_id": row[6],
                    "pcp_provider_id": row[7],
                    "risk_score": row[8],
                    "chronic_conditions": row[9],
                    "address_zip": row[10],
                }

                pcp = {}
                if member.get("pcp_provider_id"):
                    cur.execute(
                        """
                        SELECT provider_id, npi, provider_name, specialty, state, network_status, phone
                        FROM providers
                        WHERE provider_id = %s
                        """,
                        (member["pcp_provider_id"],),
                    )
                    prow = cur.fetchone()
                    if prow:
                        pcp = {
                            "provider_id": prow[0],
                            "npi": prow[1],
                            "provider_name": prow[2],
                            "specialty": prow[3],
                            "state": prow[4],
                            "network_status": prow[5],
                            "phone": prow[6],
                        }

                cur.execute(
                    """
                    SELECT care_plan_id, member_id, program, start_date::text, status, goals
                    FROM care_plans
                    WHERE member_id = %s
                    ORDER BY start_date DESC NULLS LAST
                    LIMIT 10
                    """,
                    (member_id,),
                )
                care_plans = [
                    {
                        "care_plan_id": r[0],
                        "member_id": r[1],
                        "program": r[2],
                        "start_date": r[3],
                        "status": r[4],
                        "goals": r[5],
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    """
                    SELECT assessment_id, member_id, care_plan_id, assessment_type, status, priority,
                           created_at::text, completed_at::text, overall_risk_level, summary
                    FROM assessments
                    WHERE member_id = %s
                    ORDER BY created_at DESC NULLS LAST
                    LIMIT 1
                    """,
                    (member_id,),
                )
                a = cur.fetchone()
                latest_assessment = None
                if a:
                    latest_assessment = {
                        "assessment_id": a[0],
                        "member_id": a[1],
                        "care_plan_id": a[2],
                        "assessment_type": a[3],
                        "status": a[4],
                        "priority": a[5],
                        "created_at": a[6],
                        "completed_at": a[7],
                        "overall_risk_level": a[8],
                        "summary": a[9],
                    }

                cur.execute(
                    """
                    SELECT claim_id, member_id, provider_id, service_from_date::text, service_to_date::text,
                           claim_type, total_amount::text, paid_amount::text, status,
                           diagnosis_codes, procedure_codes
                    FROM claims
                    WHERE member_id = %s
                    ORDER BY service_from_date DESC NULLS LAST
                    LIMIT 10
                    """,
                    (member_id,),
                )
                recent_claims = [
                    {
                        "claim_id": r[0],
                        "member_id": r[1],
                        "provider_id": r[2],
                        "service_from_date": r[3],
                        "service_to_date": r[4],
                        "claim_type": r[5],
                        "total_amount": r[6],
                        "paid_amount": r[7],
                        "status": r[8],
                        "diagnosis_codes": r[9],
                        "procedure_codes": r[10],
                    }
                    for r in cur.fetchall()
                ]

                cur.execute(
                    """
                    SELECT auth_id, member_id, requesting_provider_id, request_date::text, service_type,
                           status, decision_date::text, diagnosis_codes, notes_summary
                    FROM auths
                    WHERE member_id = %s
                    ORDER BY request_date DESC NULLS LAST
                    LIMIT 10
                    """,
                    (member_id,),
                )
                recent_auths = [
                    {
                        "auth_id": r[0],
                        "member_id": r[1],
                        "requesting_provider_id": r[2],
                        "request_date": r[3],
                        "service_type": r[4],
                        "status": r[5],
                        "decision_date": r[6],
                        "diagnosis_codes": r[7],
                        "notes_summary": r[8],
                    }
                    for r in cur.fetchall()
                ]

                return {
                    "found": True,
                    "member": member,
                    "pcp": pcp,
                    "care_plans": care_plans,
                    "latest_assessment": latest_assessment,
                    "recent_claims": recent_claims,
                    "recent_auths": recent_auths,
                }

    def get_assessment_summary(self, assessment_id: str) -> Dict[str, Any]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT assessment_id, member_id, case_id, care_plan_id, assessment_type, status, priority,
                           created_at::text, completed_at::text, overall_risk_level, summary
                    FROM assessments
                    WHERE assessment_id = %s
                    """,
                    (assessment_id,),
                )
                a = cur.fetchone()

                if not a:
                    return {"found": False, "assessment_id": assessment_id}

                assessment = {
                    "assessment_id": a[0],
                    "member_id": a[1],
                    "case_id": a[2],
                    "care_plan_id": a[3],
                    "assessment_type": a[4],
                    "status": a[5],
                    "priority": a[6],
                    "created_at": a[7],
                    "completed_at": a[8],
                    "overall_risk_level": a[9],
                    "summary": a[10],
                }

                member_id = assessment["member_id"]
                care_plan_id = assessment["care_plan_id"]

                cur.execute(
                    """
                    SELECT member_id, first_name, last_name, dob::text, gender, state, plan_id,
                           pcp_provider_id, risk_score::text, chronic_conditions, address_zip
                    FROM members
                    WHERE member_id = %s
                    """,
                    (member_id,),
                )
                m = cur.fetchone()
                member = {}
                if m:
                    member = {
                        "member_id": m[0],
                        "first_name": m[1],
                        "last_name": m[2],
                        "dob": m[3],
                        "gender": m[4],
                        "state": m[5],
                        "plan_id": m[6],
                        "pcp_provider_id": m[7],
                        "risk_score": m[8],
                        "chronic_conditions": m[9],
                        "address_zip": m[10],
                    }

                cur.execute(
                    """
                    SELECT care_plan_id, member_id, program, start_date::text, status, goals
                    FROM care_plans
                    WHERE care_plan_id = %s
                    """,
                    (care_plan_id,),
                )
                cp = cur.fetchone()
                care_plan = {}
                if cp:
                    care_plan = {
                        "care_plan_id": cp[0],
                        "member_id": cp[1],
                        "program": cp[2],
                        "start_date": cp[3],
                        "status": cp[4],
                        "goals": cp[5],
                    }

                cur.execute(
                    """
                    SELECT r.question_id, q.domain, q.question_text, r.answer_value, r.flag_risk, r.answered_at::text
                    FROM assessment_responses r
                    LEFT JOIN assessment_questions q ON q.question_id = r.question_id
                    WHERE r.assessment_id = %s
                    ORDER BY r.answered_at ASC NULLS LAST
                    """,
                    (assessment_id,),
                )
                responses = []
                flagged = []
                for r in cur.fetchall():
                    item = {
                        "question_id": r[0],
                        "domain": r[1] or "",
                        "question_text": r[2] or "",
                        "answer_value": r[3],
                        "flag_risk": r[4],
                        "answered_at": r[5],
                    }
                    responses.append(item)
                    if str(item["flag_risk"]) == "1":
                        flagged.append(item)

                cur.execute(
                    """
                    SELECT note_id, member_id, assessment_id, author, created_at::text, note_text
                    FROM case_notes
                    WHERE assessment_id = %s
                    ORDER BY created_at DESC NULLS LAST
                    LIMIT 10
                    """,
                    (assessment_id,),
                )
                recent_case_notes = [
                    {
                        "note_id": r[0],
                        "member_id": r[1],
                        "assessment_id": r[2],
                        "author": r[3],
                        "created_at": r[4],
                        "note_text": r[5],
                    }
                    for r in cur.fetchall()
                ]

                return {
                    "found": True,
                    "assessment": assessment,
                    "member": member,
                    "care_plan": care_plan,
                    "responses": responses,
                    "flagged_responses": flagged,
                    "recent_case_notes": recent_case_notes,
                }

    def search_members(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT m.member_id, m.first_name, m.last_name, m.dob::text, m.gender, m.plan_id,
                           m.risk_score::text, m.chronic_conditions,
                           COUNT(c.case_id) AS case_count
                    FROM members m
                    LEFT JOIN cases c ON c.member_id = m.member_id
                    WHERE m.member_id ILIKE %s OR m.first_name ILIKE %s OR m.last_name ILIKE %s
                       OR CONCAT(m.first_name, ' ', m.last_name) ILIKE %s
                    GROUP BY m.member_id, m.first_name, m.last_name, m.dob, m.gender, m.plan_id,
                             m.risk_score, m.chronic_conditions
                    ORDER BY m.risk_score DESC NULLS LAST, m.last_name, m.first_name
                    LIMIT %s
                    """,
                    (f"%{query}%", f"%{query}%", f"%{query}%", f"%{query}%", limit),
                )
                return [
                    {"member_id": r[0], "first_name": r[1], "last_name": r[2],
                     "dob": r[3], "gender": r[4], "plan_id": r[5],
                     "risk_score": r[6], "chronic_conditions": r[7], "case_count": r[8]}
                    for r in cur.fetchall()
                ]

    def get_member_cases(self, member_id: str) -> List[Dict[str, Any]]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT case_id, member_id, title, status, open_date::text, close_date::text, assigned_nurse, program
                    FROM cases
                    WHERE member_id = %s
                    ORDER BY open_date DESC NULLS LAST
                    """,
                    (member_id,),
                )
                return [
                    {"case_id": r[0], "member_id": r[1], "title": r[2], "status": r[3],
                     "open_date": r[4], "close_date": r[5], "assigned_nurse": r[6], "program": r[7]}
                    for r in cur.fetchall()
                ]

    def get_case(self, case_id: str) -> Optional[Dict[str, Any]]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT case_id, member_id, title, status, open_date::text, close_date::text, assigned_nurse, program
                    FROM cases WHERE case_id = %s
                    """,
                    (case_id,),
                )
                r = cur.fetchone()
                if not r:
                    return None
                return {"case_id": r[0], "member_id": r[1], "title": r[2], "status": r[3],
                        "open_date": r[4], "close_date": r[5], "assigned_nurse": r[6], "program": r[7]}

    def get_case_assessments(self, case_id: str) -> List[Dict[str, Any]]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT assessment_id, member_id, case_id, care_plan_id, assessment_type,
                           status, priority, created_at::text, completed_at::text, overall_risk_level, summary
                    FROM assessments
                    WHERE case_id = %s
                    ORDER BY created_at DESC NULLS LAST
                    """,
                    (case_id,),
                )
                return [
                    {"assessment_id": r[0], "member_id": r[1], "case_id": r[2], "care_plan_id": r[3],
                     "assessment_type": r[4], "status": r[5], "priority": r[6],
                     "created_at": r[7], "completed_at": r[8], "overall_risk_level": r[9], "summary": r[10]}
                    for r in cur.fetchall()
                ]

    def get_assessment_tasks(self, assessment_id: str) -> List[Dict[str, Any]]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT task_id, assessment_id, case_id, member_id, phase, title, status, due_date::text
                    FROM tasks
                    WHERE assessment_id = %s
                    ORDER BY phase, task_id
                    """,
                    (assessment_id,),
                )
                return [
                    {"task_id": r[0], "assessment_id": r[1], "case_id": r[2], "member_id": r[3],
                     "phase": r[4], "title": r[5], "status": r[6], "due_date": r[7]}
                    for r in cur.fetchall()
                ]

    def get_case_summary(self, case_id: str) -> Dict[str, Any]:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT case_id, member_id, title, status, open_date::text, close_date::text, assigned_nurse, program
                    FROM cases WHERE case_id = %s
                    """,
                    (case_id,),
                )
                r = cur.fetchone()
                if not r:
                    return {"found": False, "case_id": case_id}

                case = {"case_id": r[0], "member_id": r[1], "title": r[2], "status": r[3],
                        "open_date": r[4], "close_date": r[5], "assigned_nurse": r[6], "program": r[7]}
                member_id = case["member_id"]

                cur.execute(
                    """
                    SELECT member_id, first_name, last_name, dob::text, gender, state, plan_id,
                           pcp_provider_id, risk_score::text, chronic_conditions
                    FROM members WHERE member_id = %s
                    """,
                    (member_id,),
                )
                m = cur.fetchone()
                member = {}
                if m:
                    member = {"member_id": m[0], "first_name": m[1], "last_name": m[2],
                              "dob": m[3], "gender": m[4], "state": m[5], "plan_id": m[6],
                              "pcp_provider_id": m[7], "risk_score": m[8], "chronic_conditions": m[9]}

                cur.execute(
                    """
                    SELECT assessment_id, assessment_type, status, priority,
                           created_at::text, completed_at::text, overall_risk_level, summary
                    FROM assessments WHERE case_id = %s
                    ORDER BY created_at DESC NULLS LAST
                    LIMIT 5
                    """,
                    (case_id,),
                )
                assessments = [
                    {"assessment_id": a[0], "assessment_type": a[1], "status": a[2],
                     "priority": a[3], "created_at": a[4], "completed_at": a[5],
                     "overall_risk_level": a[6], "summary": a[7]}
                    for a in cur.fetchall()
                ]

                cur.execute(
                    """
                    SELECT n.note_id, n.assessment_id, n.author, n.created_at::text, n.note_text
                    FROM case_notes n
                    JOIN assessments a ON a.assessment_id = n.assessment_id
                    WHERE a.case_id = %s
                    ORDER BY n.created_at DESC NULLS LAST
                    LIMIT 10
                    """,
                    (case_id,),
                )
                recent_notes = [
                    {"note_id": r[0], "assessment_id": r[1], "author": r[2],
                     "created_at": r[3], "note_text": r[4]}
                    for r in cur.fetchall()
                ]

                return {
                    "found": True,
                    "case": case,
                    "member": member,
                    "assessments": assessments,
                    "recent_notes": recent_notes,
                }

    def get_assessment_member_id(self, assessment_id: str) -> str:
        with _conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT member_id FROM assessments WHERE assessment_id = %s",
                    (assessment_id,),
                )
                row = cur.fetchone()
                return row[0] if row else ""


_STORE: Optional[PGStore] = None


def store() -> PGStore:
    global _STORE
    if _STORE is None:
        _STORE = PGStore()
    return _STORE
