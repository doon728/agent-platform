import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

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

export default function MemberProfile() {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const [member, setMember] = useState<any>(null);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

      {/* Member Header */}
      <div style={{
        padding: "16px 20px",
        background: "#0f172a",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc" }}>
              {m.first_name} {m.last_name}
            </div>
            <div style={{ color: "#64748b", fontSize: 13, marginTop: 4, display: "flex", gap: 16 }}>
              <span>{m.member_id}</span>
              <span>DOB: {m.dob}</span>
              <span>Plan: {m.plan_id}</span>
              {m.gender && <span>Gender: {m.gender}</span>}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#64748b" }}>Risk Score</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: parseFloat(m.risk_score) >= 3 ? "#f87171" : parseFloat(m.risk_score) >= 2 ? "#fcd34d" : "#4ade80" }}>
              {m.risk_score}
            </div>
          </div>
        </div>
        {m.chronic_conditions && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
            <span style={{ color: "#475569" }}>Conditions: </span>{m.chronic_conditions}
          </div>
        )}
      </div>

      {/* Cases */}
      <div style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc", marginBottom: 10 }}>
        Cases ({cases.length})
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cases.length === 0 && (
          <div style={{ color: "#475569", fontSize: 13 }}>No cases found.</div>
        )}
        {cases.map((c) => (
          <div
            key={c.case_id}
            onClick={() => navigate(`/cases/${c.case_id}`)}
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
              <div style={{ fontWeight: 600, color: "#f8fafc", fontSize: 14 }}>{c.title}</div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                {c.case_id} · Opened: {c.open_date} · Nurse: {c.assigned_nurse}
              </div>
            </div>
            <span style={{ color: "#64748b", fontSize: 12 }}>{c.program}</span>
            <StatusBadge status={c.status} />
            <span style={{ color: "#6366f1", fontSize: 12 }}>View →</span>
          </div>
        ))}
      </div>
    </div>
  );
}
