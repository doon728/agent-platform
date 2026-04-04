import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SummaryPanel from "../../components/SummaryPanel";
import InlineChatPanel, { ChatContext } from "../../components/InlineChatPanel";

const TOOL_GATEWAY = "http://localhost:8080";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    OPEN:      { bg: "rgba(22,163,74,0.1)",    color: "#15803d", border: "rgba(22,163,74,0.3)" },
    COMPLETED: { bg: "rgba(99,102,241,0.1)",   color: "#4338ca", border: "rgba(99,102,241,0.3)" },
    COMPLETE:  { bg: "rgba(99,102,241,0.1)",   color: "#4338ca", border: "rgba(99,102,241,0.3)" },
    PENDING:   { bg: "rgba(217,119,6,0.1)",    color: "#b45309", border: "rgba(217,119,6,0.3)" },
    ACTIVE:    { bg: "rgba(22,163,74,0.1)",    color: "#15803d", border: "rgba(22,163,74,0.3)" },
    SCHEDULED: { bg: "rgba(100,116,139,0.1)",  color: "#475569", border: "rgba(100,116,139,0.3)" },
  };
  const c = colors[status] || { bg: "rgba(100,116,139,0.1)", color: "#475569", border: "rgba(100,116,139,0.3)" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {status}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    HIGH:   { bg: "rgba(220,38,38,0.1)",  color: "#dc2626", border: "rgba(220,38,38,0.25)" },
    MEDIUM: { bg: "rgba(217,119,6,0.1)",  color: "#d97706", border: "rgba(217,119,6,0.25)" },
    LOW:    { bg: "rgba(22,163,74,0.1)",  color: "#15803d", border: "rgba(22,163,74,0.25)" },
  };
  const c = colors[(level || "").toUpperCase()] || { bg: "rgba(100,116,139,0.1)", color: "#475569", border: "rgba(100,116,139,0.2)" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {level}
    </span>
  );
}

function ChatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

export default function CaseView() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState<any>(null);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatContext, setChatContext] = useState<ChatContext | null>(null);

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

  function openCaseChat() {
    setChatContext({
      type: "case",
      id: caseId!,
      label: caseData.title,
      memberId: caseData.member_id,
    });
  }

  function openAssessmentChat(a: any) {
    setChatContext({
      type: "assessment",
      id: a.assessment_id,
      label: a.assessment_type,
      memberId: caseData.member_id,
    });
  }

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

      <SummaryPanel scopeType="case" scopeId={caseId!} memberId={caseData.member_id} />

      {/* Case Header */}
      <div style={{ padding: "16px 20px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{caseData.title}</div>
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 4, display: "flex", gap: 16 }}>
              <span>{caseData.case_id}</span>
              <span>Opened: {caseData.open_date}</span>
              <span>Nurse: {caseData.assigned_nurse}</span>
              <span>Program: {caseData.program}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusBadge status={caseData.status} />
            {/* Case-level chat button */}
            <button
              onClick={openCaseChat}
              title="Chat about this case"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: chatContext?.type === "case" && chatContext.id === caseId ? "#3730a3" : "rgba(99,102,241,0.15)",
                border: `1px solid ${chatContext?.type === "case" && chatContext.id === caseId ? "#6366f1" : "rgba(99,102,241,0.3)"}`,
                cursor: "pointer",
                color: chatContext?.type === "case" && chatContext.id === caseId ? "#c7d2fe" : "#818cf8",
              }}
            >
              <ChatIcon />
              Chat
            </button>
          </div>
        </div>
      </div>

      {/* Assessments */}
      <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 10 }}>
        Assessments ({assessments.length})
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {assessments.length === 0 && (
          <div style={{ color: "#475569", fontSize: 13 }}>No assessments found.</div>
        )}
        {assessments.map((a) => {
          const isActive = chatContext?.type === "assessment" && chatContext.id === a.assessment_id;
          return (
            <div
              key={a.assessment_id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto auto",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                background: isActive ? "#eef2ff" : "#ffffff",
                border: `1px solid ${isActive ? "#6366f1" : "#e2e8f0"}`,
                borderRadius: 8,
                transition: "border-color 0.15s",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = "#c7d2fe"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = "#e2e8f0"; }}
            >
              <div style={{ cursor: "pointer" }} onClick={() => navigate(`/assessments/${a.assessment_id}`)}>
                <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 14 }}>{a.assessment_type}</div>
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                  {a.assessment_id} · Created: {a.created_at?.slice(0, 10)}
                  {a.summary && <span> · {a.summary.slice(0, 60)}{a.summary.length > 60 ? "…" : ""}</span>}
                </div>
              </div>
              <span style={{ color: "#64748b", fontSize: 12 }}>{a.priority}</span>
              {a.overall_risk_level && <RiskBadge level={a.overall_risk_level} />}
              <StatusBadge status={a.status} />
              {/* Per-assessment chat icon */}
              <button
                onClick={(e) => { e.stopPropagation(); isActive ? setChatContext(null) : openAssessmentChat(a); }}
                title="Chat about this assessment"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, borderRadius: 6,
                  background: isActive ? "#4f46e5" : "rgba(99,102,241,0.1)",
                  border: "1px solid rgba(99,102,241,0.3)",
                  cursor: "pointer", color: isActive ? "#fff" : "#818cf8",
                }}
              >
                <ChatIcon />
              </button>
            </div>
          );
        })}
      </div>

      {/* Inline chat panel — anchored below the list */}
      {chatContext && (
        <InlineChatPanel
          context={chatContext}
          onClose={() => setChatContext(null)}
        />
      )}
    </div>
  );
}
