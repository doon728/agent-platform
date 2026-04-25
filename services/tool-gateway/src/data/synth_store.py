import csv
import os
import json
from datetime import datetime
from typing import Dict, List, Optional, Any

# tool-gateway container will run with WORKDIR typically /app
DEFAULT_DATA_ROOT = os.getenv("SYNTH_DATA_ROOT", "/app/data/synth/structured")

# IMPORTANT:
# Runtime notes are written by agent-runtime to /app/state/written_case_notes.jsonl
# We will read that file from tool-gateway too (requires docker-compose volume mapping).
RUNTIME_NOTES_PATH = os.getenv("RUNTIME_NOTES_PATH", "/app/state/written_case_notes.jsonl")


def _read_csv(filename: str) -> List[Dict[str, str]]:
    path = os.path.join(DEFAULT_DATA_ROOT, filename)
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _index_by(rows: List[Dict[str, str]], key: str) -> Dict[str, Dict[str, str]]:
    out: Dict[str, Dict[str, str]] = {}
    for r in rows:
        out[r[key]] = r
    return out


def _filter(rows: List[Dict[str, str]], key: str, value: str) -> List[Dict[str, str]]:
    return [r for r in rows if r.get(key) == value]


def _sort_by_date(rows: List[Dict[str, Any]], key: str, desc: bool = True) -> List[Dict[str, Any]]:
    def parse(d: str) -> datetime:
        # supports YYYY-MM-DD or ISO
        if not d:
            return datetime.min
        try:
            return datetime.fromisoformat(d.replace("Z", ""))
        except Exception:
            return datetime.min

    return sorted(rows, key=lambda r: parse(str(r.get(key, ""))), reverse=desc)


def _read_runtime_case_notes(assessment_id: str, path: str = RUNTIME_NOTES_PATH) -> List[Dict[str, Any]]:
    """
    Read runtime-written notes (JSONL) and normalize them to the same shape as CSV notes.
    Expected JSONL record (from write_case_note tool):
      {
        "note_id": "...",
        "assessment_id": "asmt-000001",
        "author": "nurse-001",
        "created_at": "2026-03-05T22:02:11Z",
        "note_text": "..."
      }
    We normalize to:
      {
        "note_id": "...",
        "member_id": "",             # runtime note may not have it
        "assessment_id": "...",
        "author": "...",
        "created_at": "...",
        "note_text": "..."
      }
    """
    if not path:
        return []

    if not os.path.exists(path):
        return []

    out: List[Dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue

                if rec.get("assessment_id") != assessment_id:
                    continue

                out.append(
                    {
                        "note_id": rec.get("note_id", ""),
                        "member_id": rec.get("member_id", ""),  # usually absent in runtime notes
                        "assessment_id": rec.get("assessment_id", ""),
                        "author": rec.get("author", ""),
                        "created_at": rec.get("created_at", ""),
                        "note_text": rec.get("note_text", ""),
                    }
                )
    except Exception:
        return []

    return out


class SynthStore:
    """
    Simple in-memory loader (CSV into lists) for MVP.
    Loads once per process. Good enough for demo.
    """

    def __init__(self) -> None:
        self.members = _read_csv("members.csv")
        self.providers = _read_csv("providers.csv")
        self.care_plans = _read_csv("care_plans.csv")
        self.assessments = _read_csv("assessments.csv")
        self.assessment_questions = _read_csv("assessment_questions.csv")
        self.assessment_responses = _read_csv("assessment_responses.csv")
        self.claims = _read_csv("claims.csv")
        self.auths = _read_csv("auths.csv")
        self.case_notes = _read_csv("case_notes.csv")

        self.members_by_id = _index_by(self.members, "member_id")
        self.providers_by_id = _index_by(self.providers, "provider_id")
        self.care_plans_by_id = _index_by(self.care_plans, "care_plan_id")
        self.assessments_by_id = _index_by(self.assessments, "assessment_id")
        self.questions_by_id = _index_by(self.assessment_questions, "question_id")

    def get_member_summary(self, member_id: str) -> Dict[str, Any]:
        m = self.members_by_id.get(member_id)
        if not m:
            return {"found": False, "member_id": member_id}

        pcp = self.providers_by_id.get(m.get("pcp_provider_id", ""), {})

        cps = _filter(self.care_plans, "member_id", member_id)
        asmts = _filter(self.assessments, "member_id", member_id)
        asmts_sorted = _sort_by_date(asmts, "created_at", desc=True)
        latest_asmt = asmts_sorted[0] if asmts_sorted else None

        recent_claims = _sort_by_date(_filter(self.claims, "member_id", member_id), "service_from_date", desc=True)[:10]
        recent_auths = _sort_by_date(_filter(self.auths, "member_id", member_id), "request_date", desc=True)[:10]

        return {
            "found": True,
            "member": m,
            "pcp": pcp,
            "care_plans": cps[:10],
            "latest_assessment": latest_asmt,
            "recent_claims": recent_claims,
            "recent_auths": recent_auths,
        }

    def get_assessment_summary(self, assessment_id: str) -> Dict[str, Any]:
        a = self.assessments_by_id.get(assessment_id)
        if not a:
            return {"found": False, "assessment_id": assessment_id}

        member_id = a["member_id"]
        m = self.members_by_id.get(member_id, {})
        cp = self.care_plans_by_id.get(a.get("care_plan_id", ""), {})

        # responses joined with question text
        rs = _filter(self.assessment_responses, "assessment_id", assessment_id)
        rs = _sort_by_date(rs, "answered_at", desc=False)

        enriched: List[Dict[str, Any]] = []
        flagged: List[Dict[str, Any]] = []
        for r in rs:
            q = self.questions_by_id.get(r["question_id"], {})
            item = {
                "question_id": r["question_id"],
                "domain": q.get("domain", ""),
                "question_text": q.get("question_text", ""),
                "answer_value": r.get("answer_value", ""),
                "flag_risk": r.get("flag_risk", "0"),
                "answered_at": r.get("answered_at", ""),
            }
            enriched.append(item)
            if item["flag_risk"] == "1":
                flagged.append(item)

        # ---- CASE NOTES (MERGE) ----
        # 1) synth CSV notes
        synth_notes = _filter(self.case_notes, "assessment_id", assessment_id)
        synth_notes_sorted = _sort_by_date(synth_notes, "created_at", desc=True)

        # 2) runtime notes from JSONL
        runtime_notes = _read_runtime_case_notes(assessment_id)
        runtime_notes_sorted = _sort_by_date(runtime_notes, "created_at", desc=True)

        # Combine + de-dupe by note_id (runtime wins if same note_id somehow repeats)
        combined_by_id: Dict[str, Dict[str, Any]] = {}
        for n in synth_notes_sorted:
            nid = n.get("note_id", "") or ""
            if nid:
                combined_by_id[nid] = n
        for n in runtime_notes_sorted:
            nid = str(n.get("note_id", "") or "")
            if nid:
                combined_by_id[nid] = n

        combined = list(combined_by_id.values())
        combined = _sort_by_date(combined, "created_at", desc=True)[:10]

        return {
            "found": True,
            "assessment": a,
            "member": m,
            "care_plan": cp,
            "responses": enriched,
            "flagged_responses": flagged,
            "recent_case_notes": combined,
        }


# singleton store
_STORE: Optional[SynthStore] = None


def store() -> SynthStore:
    global _STORE
    if _STORE is None:
        _STORE = SynthStore()
    return _STORE