import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SummaryPanel from "../../components/SummaryPanel";
import InlineChatPanel, { ChatContext } from "../../components/InlineChatPanel";

const TOOL_GATEWAY = "http://localhost:8080";

function StatusBadge({ status }: { status: string }) {
  const isOpen = status === "OPEN";
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
      background: isOpen ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.2)",
      color: isOpen ? "#4ade80" : "#94a3b8",
      border: `1px solid ${isOpen ? "rgba(34,197,94,0.3)" : "rgba(100,116,139,0.3)"}`,
    }}>
      {status}
    </span>
  );
}

function ChatIcon({ active }: { active?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

export default function MemberProfile() {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const [member, setMember] = useState<any>(null);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatContext, setChatContext] = useState<ChatContext | null>(null);

  useEffect(() => {
    if (!memberId) return;
    Promise.all([
      fetch(`${TOOL_GATEWAY}/members/${memberId}`).then((r) => r.json()),
      fetch(`${TOOL_GATEWAY}/members/${memberId}/cases`).then((r) => r.json()),
    ]).then(([mData, cData]) => {
      setMember(mData.member?.member || mData.member);
      setCases(cData.cases || []);
    }).finally(() => setLoading(false));
  }, [memberId]);

  if (loading) return <div className="card" style={{ color: "#64748b" }}>Loading...</div>;
  if (!member) return <div className="card" style={{ color: "#f87171" }}>Member not found.</div>;

  const m = member.member || member;

  function openMemberChat() {
    setChatContext({
      type: "member",
      id: memberId!,
      label: `${m.first_name} ${m.last_name}`,
    });
  }

  function openCaseChat(c: any) {
    setChatContext({
      type: "case",
      id: c.case_id,
      label: c.title,
      memberId: memberId,
    });
  }

  return (
    <div className="card">
      {/* Back */}
      <button
        className="btn secondary"
        style={{ marginBottom: 16, fontSize: 12 }}
        onClick={() => navigate("/members")}
      >
        ← Back to Members
      </button>

      <SummaryPanel scopeType="member" scopeId={memberId!} />

      {/* Member Header */}
      <div style={{
        padding: "16px 20px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderLeft: "4px solid #3b82f6",
        borderRadius: 10, marginBottom: 20,
        boxShadow: "0 1px 4px rgba(59,130,246,0.08)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f" }}>
              {m.first_name} {m.last_name}
            </div>
            <div style={{ color: "#64748b", fontSize: 13, marginTop: 4, display: "flex", gap: 16 }}>
              <span>{m.member_id}</span>
              <span>DOB: {m.dob}</span>
              <span>Plan: {m.plan_id}</span>
              {m.gender && <span>Gender: {m.gender}</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#64748b" }}>Risk Score</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: parseFloat(m.risk_score) >= 3 ? "#f87171" : parseFloat(m.risk_score) >= 2 ? "#fcd34d" : "#4ade80" }}>
                {m.risk_score}
              </div>
            </div>
            {/* Member-level chat button */}
            <button
              onClick={openMemberChat}
              title="Chat about this member"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: chatContext?.type === "member" ? "#3730a3" : "rgba(99,102,241,0.15)",
                border: `1px solid ${chatContext?.type === "member" ? "#6366f1" : "rgba(99,102,241,0.3)"}`,
                cursor: "pointer",
                color: chatContext?.type === "member" ? "#c7d2fe" : "#818cf8",
                marginTop: 2,
              }}
            >
              <ChatIcon />
              Chat
            </button>
          </div>
        </div>
        {m.chronic_conditions && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
            <span style={{ color: "#475569" }}>Conditions: </span>{m.chronic_conditions}
          </div>
        )}
      </div>

      {/* Cases */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Cases
        </span>
        <span style={{ fontSize: 11, color: "#4ade80", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", padding: "1px 8px", borderRadius: 10, fontWeight: 700 }}>
          {cases.length}
        </span>
        <div style={{ flex: 1, height: 1, background: "rgba(34,197,94,0.2)" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cases.length === 0 && (
          <div style={{ color: "#475569", fontSize: 13 }}>No cases found.</div>
        )}
        {cases.map((c) => {
          const isActive = chatContext?.type === "case" && chatContext.id === c.case_id;
          return (
            <div
              key={c.case_id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto auto",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                background: c.status === "OPEN" ? "#f0fdf4" : "#f8fafc",
                border: `1px solid ${isActive ? "#6366f1" : c.status === "OPEN" ? "#bbf7d0" : "#e2e8f0"}`,
                borderLeft: `4px solid ${c.status === "OPEN" ? "#16a34a" : "#94a3b8"}`,
                borderRadius: 8,
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
            >
              <div style={{ cursor: "pointer" }} onClick={() => navigate(`/cases/${c.case_id}`)}>
                <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 14 }}>{c.title}</div>
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                  {c.case_id} · Opened: {c.open_date} · Nurse: {c.assigned_nurse}
                </div>
              </div>
              <span style={{ color: "#64748b", fontSize: 12 }}>{c.program}</span>
              <StatusBadge status={c.status} />
              {/* Per-case chat icon */}
              <button
                onClick={(e) => { e.stopPropagation(); isActive ? setChatContext(null) : openCaseChat(c); }}
                title="Chat about this case"
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
              <span
                style={{ color: "#6366f1", fontSize: 12, cursor: "pointer" }}
                onClick={() => navigate(`/cases/${c.case_id}`)}
              >
                View →
              </span>
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
