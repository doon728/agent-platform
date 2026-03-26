import React, { useEffect, useState, useCallback } from "react";
import { postJson } from "../../lib/api";

const POLL_MS = 5000;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function Supervisor() {
  const [pending, setPending] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "history">("pending");

  const loadPending = useCallback(async () => {
    try {
      const data = await fetchJson<any>("/hitl/pending");
      setPending(data.pending || []);
    } catch {}
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchJson<any>("/hitl/history");
      setHistory(data.history || []);
    } catch {}
  }, []);

  // Poll pending queue
  useEffect(() => {
    loadPending();
    const t = setInterval(loadPending, POLL_MS);
    return () => clearInterval(t);
  }, [loadPending]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  async function decide(decision: "approved" | "rejected") {
    if (!selected || !reason.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await postJson("/hitl/decide", {
        approval_id: selected.approval_id,
        decision,
        reason: reason.trim(),
        decided_by: "supervisor-001",
      });
      setSelected(null);
      setReason("");
      await loadPending();
      if (tab === "history") await loadHistory();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const elapsed = (ts: string) => {
    if (!ts) return "-";
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const statusColor = (s: string) =>
    s === "pending" ? "#f59e0b" : s === "approved" ? "#4ade80" : "#f87171";

  return (
    <div className="card">
      <div className="h1">Approval Console</div>
      <div className="small" style={{ marginBottom: 16 }}>
        Review and act on pending approvals for high-risk agent actions.
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["pending", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: tab === t ? "#1d4ed8" : "#1e293b",
              color: "#f8fafc",
              cursor: "pointer",
              fontWeight: tab === t ? 700 : 400,
            }}
          >
            {t === "pending" ? `Pending (${pending.length})` : "History"}
          </button>
        ))}
      </div>

      {/* Pending Queue */}
      {tab === "pending" && (
        <div style={{ display: "flex", gap: 16 }}>
          {/* List */}
          <div style={{ flex: 1 }}>
            {pending.length === 0 && (
              <div style={{ padding: 12, background: "#0f172a", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}>
                No pending approvals.
              </div>
            )}
            {pending.map((a) => (
              <div
                key={a.approval_id}
                onClick={() => { setSelected(a); setReason(""); setErr(null); }}
                style={{
                  padding: 12, marginBottom: 8, borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${selected?.approval_id === a.approval_id ? "#f59e0b" : "rgba(255,255,255,0.1)"}`,
                  background: selected?.approval_id === a.approval_id ? "#3b2a11" : "#1e293b",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, color: "#fbbf24" }}>{a.tool_name}</span>
                  <span style={{ color: "#94a3b8", fontSize: 12 }}>{elapsed(a.requested_at)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                  By {a.requested_by} · {a.risk_level} risk · {a.assessment_id || a.case_id || "-"}
                </div>
              </div>
            ))}
          </div>

          {/* Detail + Actions */}
          {selected && (
            <div style={{ flex: 1.5, padding: 16, background: "#1e293b", borderRadius: 12, border: "1px solid rgba(245,158,11,0.4)" }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: "#fbbf24" }}>
                Review: {selected.tool_name}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  ["Requested by", selected.requested_by],
                  ["Risk level", selected.risk_level],
                  ["Assessment", selected.assessment_id || "-"],
                  ["Case", selected.case_id || "-"],
                  ["Member", selected.member_id || "-"],
                  ["Waiting", elapsed(selected.requested_at)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{k}</div>
                    <div style={{ color: "#f8fafc", fontSize: 13 }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Tool Input</div>
                <pre style={{ background: "#0f172a", padding: 10, borderRadius: 8, fontSize: 12, color: "#94a3b8", overflow: "auto", maxHeight: 150 }}>
                  {JSON.stringify(selected.tool_input, null, 2)}
                </pre>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Reason (required)</div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter reason for approval or rejection..."
                  style={{ width: "100%", minHeight: 60, background: "#0f172a", color: "#f8fafc", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: 8, fontSize: 13 }}
                />
              </div>

              {err && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 8 }}>{err}</div>}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => decide("approved")}
                  disabled={busy || !reason.trim()}
                  style={{ flex: 1, padding: "10px", borderRadius: 8, background: reason.trim() ? "#166534" : "#1e293b", color: "#4ade80", border: "1px solid #166534", cursor: reason.trim() ? "pointer" : "not-allowed", fontWeight: 700 }}
                >
                  {busy ? "Processing..." : "✓ Approve"}
                </button>
                <button
                  onClick={() => decide("rejected")}
                  disabled={busy || !reason.trim()}
                  style={{ flex: 1, padding: "10px", borderRadius: 8, background: reason.trim() ? "#7f1d1d" : "#1e293b", color: "#f87171", border: "1px solid #7f1d1d", cursor: reason.trim() ? "pointer" : "not-allowed", fontWeight: 700 }}
                >
                  {busy ? "Processing..." : "✗ Reject"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {tab === "history" && (
        <div>
          {history.length === 0 && (
            <div style={{ padding: 12, background: "#0f172a", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}>
              No history yet.
            </div>
          )}
          {history.map((a) => (
            <div key={a.approval_id} style={{ padding: 12, marginBottom: 8, borderRadius: 10, background: "#1e293b", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700 }}>{a.tool_name}</span>
                <span style={{ fontSize: 12, color: statusColor(a.status), fontWeight: 700 }}>{a.status.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                By {a.requested_by} · {a.decided_by ? `decided by ${a.decided_by}` : "pending"} · {elapsed(a.requested_at)}
              </div>
              {a.decision_reason && (
                <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>
                  Reason: {a.decision_reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
