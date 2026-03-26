import React, { useEffect, useState } from "react";
import { postJson } from "../lib/api";

interface SummaryData {
  ok: boolean;
  cached: boolean;
  generated_at: string;
  summary?: string;
  key_concerns?: string[];
  last_action?: string;
  next_steps?: string[];
  error?: string;
}

interface Props {
  scopeType: "assessment" | "case" | "member";
  scopeId: string;
  tenantId?: string;
  memberId?: string;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function SummaryPanel({ scopeType, scopeId, tenantId = "t1", memberId }: Props) {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  async function load(forceRefresh = false) {
    setLoading(true);
    try {
      const res = await postJson<SummaryData>("/summarize", {
        scope_type: scopeType,
        scope_id: scopeId,
        tenant_id: tenantId,
        member_id: memberId,
        force_refresh: forceRefresh,
      });
      setData(res);
    } catch (e: any) {
      setData({ ok: false, cached: false, generated_at: "", error: e?.message || "Failed" });
    }
    setLoading(false);
  }

  useEffect(() => {
    if (scopeId) load();
  }, [scopeId]);

  const borderColor = data?.ok === false ? "#fca5a5" : "#c7d2fe";
  const headerBg = data?.ok === false ? "#fef2f2" : "#eef2ff";
  const labelColor = "#4f46e5";

  return (
    <div style={{
      border: `1px solid ${borderColor}`,
      borderLeft: `3px solid ${data?.ok === false ? "#ef4444" : "#6366f1"}`,
      borderRadius: 10,
      overflow: "hidden",
      background: "#ffffff",
      marginBottom: 14,
      boxShadow: "0 1px 4px rgba(99,102,241,0.08)",
    }}>
      {/* Header row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px", background: headerBg, cursor: "pointer",
      }} onClick={() => setExpanded((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#4f46e5" }}>
            {expanded ? "▼" : "▶"} AI Summary
          </span>
          {loading && (
            <span style={{ fontSize: 10, color: "#94a3b8" }}>generating…</span>
          )}
          {!loading && data?.generated_at && (
            <span style={{ fontSize: 10, color: "#94a3b8" }}>
              {data.cached ? "cached" : "fresh"} · {timeAgo(data.generated_at)}
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); load(true); }}
          disabled={loading}
          style={{
            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
            background: "#eef2ff", border: "1px solid #c7d2fe",
            color: "#4f46e5", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: "10px 14px" }}>
          {loading && (
            <div style={{ color: "#94a3b8", fontSize: 12, padding: "8px 0" }}>
              Generating summary…
            </div>
          )}

          {!loading && data?.ok === false && (
            <div style={{ color: "#ef4444", fontSize: 12, padding: "4px 0" }}>
              {data.error || "Could not generate summary."}
            </div>
          )}

          {!loading && data?.ok && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

              {data.summary && (
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.55 }}>
                  {data.summary}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

                {data.key_concerns && data.key_concerns.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
                      Key Concerns
                    </div>
                    {data.key_concerns.map((c, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#475569", lineHeight: 1.4, paddingLeft: 8, borderLeft: "2px solid #fca5a5", marginBottom: 4 }}>
                        {c}
                      </div>
                    ))}
                  </div>
                )}

                {data.next_steps && data.next_steps.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
                      Next Steps
                    </div>
                    {data.next_steps.map((s, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#475569", lineHeight: 1.4, paddingLeft: 8, borderLeft: "2px solid #86efac", marginBottom: 4 }}>
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {data.last_action && (
                <div style={{ fontSize: 11, color: "#94a3b8", borderTop: "1px solid #f1f5f9", paddingTop: 6 }}>
                  <span style={{ color: "#64748b" }}>Last action: </span>{data.last_action}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
