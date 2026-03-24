import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const TOOL_GATEWAY = "http://localhost:8080";

function riskColor(score: string | number) {
  const s = parseFloat(String(score));
  if (s >= 3) return "#f87171";
  if (s >= 2) return "#fcd34d";
  return "#4ade80";
}

function riskLabel(score: string | number) {
  const s = parseFloat(String(score));
  if (s >= 3) return "High";
  if (s >= 2) return "Medium";
  return "Low";
}

export default function Members() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function fetchMembers(q: string) {
    setLoading(true);
    try {
      const res = await fetch(`${TOOL_GATEWAY}/members?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setMembers(data.members || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    setSearched(true);
    fetchMembers(q);
  }

  return (
    <div className="card">
      <div className="h1" style={{ marginBottom: 16 }}>Member Search</div>

      <input
        className="input"
        style={{ width: "100%", marginBottom: 16, fontSize: 14, padding: "10px 12px" }}
        placeholder="Search by name or member ID..."
        value={query}
        onChange={handleSearch}
      />

      {loading && <div style={{ color: "#64748b", fontSize: 13 }}>Searching...</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((m) => (
          <div
            key={m.member_id}
            onClick={() => navigate(`/members/${m.member_id}`)}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto auto",
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
              <div style={{ fontWeight: 600, color: "#f8fafc", fontSize: 14 }}>
                {m.first_name} {m.last_name}
              </div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                {m.member_id} · DOB: {m.dob} · {m.plan_id}
              </div>
              {m.chronic_conditions && (
                <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{m.chronic_conditions}</div>
              )}
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
              color: riskColor(m.risk_score),
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${riskColor(m.risk_score)}44`,
            }}>
              {riskLabel(m.risk_score)} Risk
            </span>
            <span style={{ color: "#475569", fontSize: 12 }}>{m.risk_score}</span>
            <span style={{
              fontSize: 11, padding: "2px 7px", borderRadius: 4,
              background: m.case_count > 0 ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.05)",
              color: m.case_count > 0 ? "#818cf8" : "#475569",
              border: `1px solid ${m.case_count > 0 ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.08)"}`,
            }}>
              {m.case_count} {m.case_count === 1 ? "case" : "cases"}
            </span>
            <span style={{ color: "#6366f1", fontSize: 12 }}>View →</span>
          </div>
        ))}
        {!loading && !searched && (
          <div style={{ color: "#475569", fontSize: 13 }}>Type a name or member ID to search.</div>
        )}
        {!loading && searched && members.length === 0 && (
          <div style={{ color: "#475569", fontSize: 13 }}>No members found.</div>
        )}
      </div>
    </div>
  );
}
