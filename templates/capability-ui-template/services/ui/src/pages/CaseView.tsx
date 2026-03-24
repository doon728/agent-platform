import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const TOOL_GATEWAY = "http://localhost:8080";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    OPEN:      { bg: "rgba(34,197,94,0.15)",   color: "#4ade80", border: "rgba(34,197,94,0.3)" },
    COMPLETED: { bg: "rgba(99,102,241,0.15)",  color: "#818cf8", border: "rgba(99,102,241,0.3)" },
    PENDING:   { bg: "rgba(251,191,36,0.15)",  color: "#fcd34d", border: "rgba(251,191,36,0.3)" },
  };
  const c = colors[status] || { bg: "rgba(100,116,139,0.2)", color: "#94a3b8", border: "rgba(100,116,139,0.3)" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {status}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = { HIGH: "#f87171", MEDIUM: "#fcd34d", LOW: "#4ade80" };
  const color = colors[(level || "").toUpperCase()] || "#94a3b8";
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
      background: "rgba(255,255,255,0.05)", color, border: `1px solid ${color}44`,
    }}>
      {level}
    </span>
  );
}

export default function CaseView() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState<any>(null);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) return;
    Promise.all([
      fetch(`${TOOL_GATEWAY}/cases/${caseId}`).then((r) => r.json()),
      fetch(`${TOOL_GATEWAY}/cases/${caseId}/assessments`).then((r) => r.json()),
    ]).then(([cData, aData]) => {
      setCaseData(cData.case || null);
      setAssessments(aData.assessments || []);
    }).finally(() => setLoading(false));
  }, [caseId]);

  if (loading) return <div className="card" style={{ color: "#64748b" }}>Loading...</div>;
  if (!caseData) return <div className="card" style={{ color: "#f87171" }}>Case not found.</div>;

  return (
    <div className="card">
      {/* Back */}
      <button
        className="btn secondary"
        style={{ marginBottom: 16, fontSize: 12 }}
        onClick={() => navigate(`/members/${caseData.member_id}`)}
      >
        ← Back to Member
      </button>

      {/* Case Header */}
      <div style={{
        padding: "16px 20px",
        background: "#0f172a",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc" }}>{caseData.title}</div>
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 4, display: "flex", gap: 16 }}>
              <span>{caseData.case_id}</span>
              <span>Opened: {caseData.open_date}</span>
              <span>Nurse: {caseData.assigned_nurse}</span>
              <span>Program: {caseData.program}</span>
            </div>
          </div>
          <StatusBadge status={caseData.status} />
        </div>
      </div>

      {/* Assessments */}
      <div style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc", marginBottom: 10 }}>
        Assessments ({assessments.length})
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {assessments.length === 0 && (
          <div style={{ color: "#475569", fontSize: 13 }}>No assessments found.</div>
        )}
        {assessments.map((a) => (
          <div
            key={a.assessment_id}
            onClick={() => navigate(`/assessments/${a.assessment_id}`)}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              alignItems: "center",
              gap: 16,
              padding: "12px 16px",
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
          >
            <div>
              <div style={{ fontWeight: 600, color: "#f8fafc", fontSize: 14 }}>{a.assessment_type}</div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                {a.assessment_id} · Created: {a.created_at?.slice(0, 10)}
                {a.summary && <span> · {a.summary.slice(0, 60)}{a.summary.length > 60 ? "…" : ""}</span>}
              </div>
            </div>
            <span style={{ color: "#64748b", fontSize: 12 }}>{a.priority}</span>
            {a.overall_risk_level && <RiskBadge level={a.overall_risk_level} />}
            <StatusBadge status={a.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
