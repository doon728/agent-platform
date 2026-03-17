import React, { useEffect, useState } from "react";
import { postJson } from "../lib/api";

const STORAGE_APPROVAL = "nurse:pendingApproval";

export default function Supervisor() {
  const [approval, setApproval] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_APPROVAL);
      setApproval(raw ? JSON.parse(raw) : null);
    } catch {
      setApproval(null);
    }
  }, []);

  async function approve() {
    if (!approval) return;

    setBusy(true);
    setErr(null);
    setResult(null);

    try {
      const payload = {
        approved: true,
        tool_name: approval.tool_name,
        tool_input: approval.tool_input,
        ctx: approval.ctx,
      };

      const data = await postJson<any>("/approvals/resume", payload);
      setResult(data);
      
      localStorage.setItem(
        "nurse:lastApprovalResult",
        JSON.stringify({
          message: "Approval completed. The case note was written successfully.",
          ts: Date.now(),
        })
      );
      
      localStorage.removeItem("nurse:pendingApproval");
     
      setApproval(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function clearPending() {
    localStorage.removeItem(STORAGE_APPROVAL);
    setApproval(null);
    setErr(null);
    setResult(null);
  }

  return (
    <div className="card">
      <div className="h1">Approval Console</div>
      <div className="small" style={{ marginBottom: 12 }}>
        Approve sensitive actions such as writing case notes.
      </div>

      {!approval && !result && (
        <div
          style={{
            padding: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            background: "#0f172a",
          }}
        >
          No pending approval found.
        </div>
      )}

      {approval && (
        <div
          style={{
            padding: 12,
            border: "1px solid rgba(245,158,11,0.6)",
            borderRadius: 10,
            background: "#3b2a11",
            color: "#f8fafc",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Pending Approval</div>

          <div>
            <b>Action:</b> {approval.tool_name}
          </div>

          <div style={{ marginTop: 6 }}>
            <b>Assessment:</b>{" "}
            {approval.tool_input?.assessment_id || approval.tool_input?.case_id || "-"}
          </div>

          <div style={{ marginTop: 6 }}>
            <b>Note:</b> {approval.tool_input?.note || "-"}
          </div>

          <div style={{ marginTop: 6 }}>
            <b>Tenant:</b> {approval.ctx?.tenant_id || "-"}
          </div>

          <div style={{ marginTop: 6 }}>
            <b>User:</b> {approval.ctx?.user_id || "-"}
          </div>

          <div style={{ marginTop: 6 }}>
            <b>Thread:</b> {approval.ctx?.thread_id || "-"}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={approve} disabled={busy}>
              {busy ? "Approving..." : "Approve"}
            </button>

            <button className="btn" onClick={clearPending} disabled={busy}>
              Clear
            </button>
          </div>
        </div>
      )}

      {err && (
        <div style={{ marginTop: 12 }}>
          <div className="label">Error</div>
          <pre>{err}</pre>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="label">Result</div>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}