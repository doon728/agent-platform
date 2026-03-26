import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { postJson, getJson } from "../../lib/api";
import TraceGraph from "../../components/TraceGraph";

type InvocationOk = { ok: true; output: any; correlation_id: string };
type InvocationErr = {
  ok: false;
  error: { code: string; message: string };
  correlation_id?: string;
};
type InvocationResp = InvocationOk | InvocationErr;

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
};

type TraceStep = {
  type: string;
  data: any;
  timestamp: number;
};

type TraceRun = {
  run_id: string;
  agent: string;
  thread_id: string;
  prompt: string;
  steps: TraceStep[];
  total_latency_ms?: number;
};

const STORAGE_MESSAGES = "nurse:messages";
const STORAGE_APPROVAL = "nurse:pendingApproval";
const STORAGE_TENANT = "nurse:tenantId";
const STORAGE_USER = "nurse:userId";
const STORAGE_THREAD = "nurse:threadId";
const STORAGE_MEMORY_DEBUG = "nurse:memoryDebug";

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function defaultWelcomeMessage(): ChatMsg {
  return {
    id: uid(),
    role: "assistant",
    ts: Date.now(),
    text:
      "Hi — I'm the Nurse assistant.\n\nTry one of these:\n• For assessment asmt-000001 summarize status and latest note\n• What is the patient name?\n• Write a case note for assessment asmt-000001: Member is stable",
  };
}

function extractAssistantText(output: unknown): string {
  const o: any = output;
  if (!o) return "No output.";
  if (typeof o === "string") return o;
  if (typeof o?.answer === "string") return o.answer;
  return JSON.stringify(o, null, 2);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: 12,
      marginBottom: 4,
    }}>
      {title}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
      <span style={{ color: "#94a3b8", fontSize: 11 }}>{label}</span>
      <span style={{ color: "#e2e8f0", fontSize: 11, fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}

function Badge({ on }: { on: boolean }) {
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: "1px 6px",
      borderRadius: 4,
      background: on ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
      color: on ? "#4ade80" : "#f87171",
      border: `1px solid ${on ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
    }}>
      {on ? "ON" : "OFF"}
    </span>
  );
}

function ContextBanner({ ctx }: { ctx: any }) {
  const fields = [
    { label: "tenant", value: ctx.tenant_id },
    { label: "thread", value: ctx.thread_id },
    { label: "member", value: ctx.member_id },
    { label: "case", value: ctx.case_id },
    { label: "assessment", value: ctx.assessment_id },
    { label: "care_plan", value: ctx.care_plan_id },
  ].filter((f) => f.value);

  if (!fields.length) return null;

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
      padding: "6px 10px",
      background: "#0f172a",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      {fields.map((f) => (
        <span key={f.label} style={{ fontSize: 11 }}>
          <span style={{ color: "#64748b" }}>{f.label}: </span>
          <span style={{ color: "#e2e8f0", fontFamily: "monospace" }}>{f.value}</span>
        </span>
      ))}
    </div>
  );
}

function PlannerRouteBadge({ routeType }: { routeType: string }) {
  const isHard = routeType === "HARD_ROUTE";
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      padding: "1px 7px",
      borderRadius: 4,
      background: isHard ? "rgba(99,102,241,0.15)" : "rgba(245,158,11,0.15)",
      color: isHard ? "#a5b4fc" : "#fcd34d",
      border: `1px solid ${isHard ? "rgba(99,102,241,0.35)" : "rgba(245,158,11,0.35)"}`,
      fontFamily: "monospace",
    }}>
      {routeType || "—"}
    </span>
  );
}

function MemoryPanel({
  data,
  showRaw,
  onToggleRaw,
  toggles,
  onToggle,
  memoryEnabledInConfig,
}: {
  data: any;
  showRaw: boolean;
  onToggleRaw: () => void;
  toggles: Record<string, boolean>;
  onToggle: (key: string) => void;
  memoryEnabledInConfig: boolean;
}) {
  const trace = data.memory_trace || {};
  const scopes: any[] = trace.scopes || [];
  const retrieved = trace.retrieved || {};
  const written = trace.written || {};
  const skipped = trace.skipped || {};
  const assembly = trace.context_assembly || {};
  const planner = trace.planner || {};
  const router = trace.router || {};
  const executor = trace.executor || {};

  const policyKeys = ["short_term", "episodic", "summary", "semantic"];

  return (
    <div style={{
      background: "#020617",
      border: "1px solid #334155",
      borderRadius: 10,
      padding: 12,
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: "#f8fafc", marginBottom: 4 }}>
        Memory Panel
      </div>

      {/* Policy toggles */}
      <SectionHeader title="Policy" />
      {!memoryEnabledInConfig && (
        <div title="Memory is disabled for this agent. To enable, go to Agent Registry → Memory tab." style={{
          fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.1)",
          border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4,
          padding: "3px 6px", marginBottom: 6, cursor: "help",
        }}>
          ⚠ Memory disabled in config — toggles locked
        </div>
      )}
      {policyKeys.map((k) => (
        <div
          key={k}
          onClick={() => memoryEnabledInConfig && onToggle(k)}
          title={!memoryEnabledInConfig ? "Memory is disabled for this agent. To enable, go to Agent Registry → Memory tab." : undefined}
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "2px 0",
            cursor: memoryEnabledInConfig ? "pointer" : "not-allowed",
            opacity: memoryEnabledInConfig ? 1 : 0.4,
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: 11 }}>{k}</span>
          <Badge on={memoryEnabledInConfig ? !!toggles[k] : false} />
        </div>
      ))}

      {/* Planner Route */}
      <SectionHeader title="Planner" />
      {!planner.route_type ? (
        <div style={{ color: "#475569", fontSize: 11 }}>no trace yet</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
            <span style={{ color: "#94a3b8", fontSize: 11 }}>route</span>
            <PlannerRouteBadge routeType={planner.route_type} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
            <span style={{ color: "#94a3b8", fontSize: 11 }}>tool</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "#e2e8f0", fontSize: 11, fontFamily: "monospace" }}>{planner.tool || "—"}</span>
              {written.episodic?.status === "written" && written.episodic?.tool === planner.tool && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                  background: "rgba(34,197,94,0.15)", color: "#4ade80",
                  border: "1px solid rgba(34,197,94,0.3)", fontFamily: "monospace",
                }}>episodic</span>
              )}
            </span>
          </div>
          <div style={{ paddingLeft: 0, marginTop: 2, marginBottom: 4 }}>
            <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>{planner.reason || ""}</span>
          </div>
          {planner.active_assessment_id && (
            <Row label="assessment used" value={planner.active_assessment_id} />
          )}
          {planner.route_type === "LLM_ROUTE" && planner.llm_raw && (
            <div style={{ paddingLeft: 0, marginTop: 2 }}>
              <span style={{ color: "#334155", fontSize: 10, fontFamily: "monospace" }}>llm said: </span>
              <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>{planner.llm_raw}</span>
            </div>
          )}
        </>
      )}

      {/* Router */}
      <SectionHeader title="Router (Step)" />
      {!router.tool ? (
        <div style={{ color: "#475569", fontSize: 11 }}>no trace yet</div>
      ) : (
        <>
          <Row label="tool" value={router.tool} />
          <Row label="mode" value={router.mode || "—"} />
          {router.resolved_input && Object.entries(router.resolved_input).map(([k, v]: [string, any]) => (
            <div key={k} style={{ paddingLeft: 8, marginBottom: 2 }}>
              <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>{k}: </span>
              <span style={{ color: "#64748b", fontSize: 10, fontFamily: "monospace" }}>
                {typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : String(v)}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Executor */}
      <SectionHeader title="Executor" />
      {!executor.tool ? (
        <div style={{ color: "#475569", fontSize: 11 }}>no trace yet</div>
      ) : (
        <>
          <Row label="tool" value={executor.tool} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
            <span style={{ color: "#94a3b8", fontSize: 11 }}>status</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, fontFamily: "monospace",
              background: executor.status === "success" ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
              color: executor.status === "success" ? "#4ade80" : "#fcd34d",
              border: `1px solid ${executor.status === "success" ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)"}`,
            }}>
              {executor.status || "—"}
            </span>
          </div>
          {executor.output_snippet && (
            <div style={{ paddingLeft: 0, marginTop: 3 }}>
              <span style={{ color: "#334155", fontSize: 10, fontFamily: "monospace" }}>output: </span>
              <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>{executor.output_snippet}</span>
            </div>
          )}
        </>
      )}

      {/* Scopes Resolved */}
      <SectionHeader title="Scopes Resolved" />
      {scopes.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 11 }}>none</div>
      ) : (
        scopes.map((s: any) => (
          <Row key={s.scope_type} label={s.scope_type} value={s.scope_id} />
        ))
      )}

      {/* Retrieved */}
      <SectionHeader title="Retrieved" />
      <Row label="short_term" value={String(retrieved.short_term_count ?? 0)} />
      {(retrieved.short_term_snippets || []).map((t: any, i: number) => (
        <div key={i} style={{ paddingLeft: 8, marginBottom: 2 }}>
          <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>{t.role}: </span>
          <span style={{ color: "#64748b", fontSize: 10, fontFamily: "monospace" }}>{t.text}</span>
        </div>
      ))}
      <Row label="summary" value={String(retrieved.summary_count ?? 0)} />
      {retrieved.summary_snippet && (
        <div style={{ paddingLeft: 8, marginBottom: 2 }}>
          <span style={{ color: "#64748b", fontSize: 10, fontFamily: "monospace" }}>{retrieved.summary_snippet}</span>
        </div>
      )}
      <Row label="episodic" value={String(retrieved.episodic_count ?? 0)} />
      {(retrieved.episodic_snippets || []).map((s: string, i: number) => (
        <div key={i} style={{ paddingLeft: 8, marginBottom: 2 }}>
          <span style={{ color: "#64748b", fontSize: 10, fontFamily: "monospace" }}>{s}</span>
        </div>
      ))}
      <Row label="semantic" value={String(retrieved.semantic_count ?? 0)} />
      {(retrieved.semantic_snippets || []).map((s: string, i: number) => (
        <div key={i} style={{ paddingLeft: 8, marginBottom: 2 }}>
          <span style={{ color: "#64748b", fontSize: 10, fontFamily: "monospace" }}>{s}</span>
        </div>
      ))}

      {/* Written */}
      <SectionHeader title="Written" />
      {Object.keys(written).length === 0 ? (
        <div style={{ color: "#475569", fontSize: 11 }}>none</div>
      ) : (
        Object.entries(written).map(([k, v]: [string, any]) => (
          <Row key={k} label={k} value={v.status || "-"} />
        ))
      )}

      {/* Skipped */}
      {Object.keys(skipped).length > 0 && (
        <>
          <SectionHeader title="Skipped" />
          {Object.entries(skipped).map(([k, v]: [string, any]) => (
            <Row key={k} label={k} value={v.reason || "-"} />
          ))}
        </>
      )}

      {/* Context Assembly */}
      <SectionHeader title="Context Assembly" />
      <Row label="prefer_summaries" value={String(assembly.prefer_summaries_over_raw ?? "-")} />
      <Row label="deduplicate" value={String(assembly.deduplicate ?? "-")} />
      <Row label="max_items" value={String(assembly.max_total_items ?? "-")} />

      {/* Technical Details */}
      <div style={{ marginTop: 10, borderTop: "1px solid #1e293b", paddingTop: 8 }}>
        <button
          onClick={onToggleRaw}
          style={{ fontSize: 11, color: "#475569", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {showRaw ? "▼" : "▶"} Technical Details
        </button>
        {showRaw && (
          <pre style={{
            marginTop: 6,
            color: "#64748b",
            overflow: "auto",
            maxHeight: 300,
            fontSize: 10,
            lineHeight: 1.4,
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function Nurse() {
  const navigate = useNavigate();

  const [tenantId, setTenantId] = useState(() => localStorage.getItem(STORAGE_TENANT) || "t1");
  const [userId, setUserId] = useState(() => localStorage.getItem(STORAGE_USER) || "u1");
  const [threadId, setThreadId] = useState(() => localStorage.getItem(STORAGE_THREAD) || "th-1");

  const [memberId, setMemberId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [carePlanId, setCarePlanId] = useState("");

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_MESSAGES);
      if (!raw) return [defaultWelcomeMessage()];
      return JSON.parse(raw);
    } catch {
      return [defaultWelcomeMessage()];
    }
  });

  const [pendingApproval, setPendingApproval] = useState<any | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_APPROVAL);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [showTrace, setShowTrace] = useState(true);
  const [memoryDebug, setMemoryDebug] = useState<any | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_MEMORY_DEBUG);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [showRawDebug, setShowRawDebug] = useState(false);
  const [memoryToggles, setMemoryToggles] = useState({
    short_term: true,
    episodic: true,
    summary: true,
    semantic: false,
  });
  const [configFlags, setConfigFlags] = useState<{ memory_enabled: boolean; hitl_enabled: boolean } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Fetch agent config flags once on mount to know what is enabled at config level
  useEffect(() => {
    getJson<{ ok: boolean; memory_enabled: boolean; hitl_enabled: boolean }>("/config-flags")
      .then((data) => { if (data.ok) setConfigFlags(data); })
      .catch(() => {}); // fail silently — toggles remain enabled if flags can't be fetched
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_TENANT, tenantId);
    localStorage.setItem(STORAGE_USER, userId);
    localStorage.setItem(STORAGE_THREAD, threadId);
  }, [tenantId, userId, threadId]);

  useEffect(() => {
    if (memoryDebug) {
      try { localStorage.setItem(STORAGE_MEMORY_DEBUG, JSON.stringify(memoryDebug)); } catch {}
    } else {
      localStorage.removeItem(STORAGE_MEMORY_DEBUG);
    }
  }, [memoryDebug]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (pendingApproval) {
      localStorage.setItem(STORAGE_APPROVAL, JSON.stringify(pendingApproval));
    } else {
      localStorage.removeItem(STORAGE_APPROVAL);
    }
  }, [pendingApproval]);

  useEffect(() => {
    const result = localStorage.getItem("nurse:lastApprovalResult");
    if (result) {
      try {
        const parsed = JSON.parse(result);
        setMessages((m) => [...m, { id: uid(), role: "assistant", ts: Date.now(), text: parsed.message || "Approval completed." }]);
      } catch {}
      localStorage.removeItem("nurse:lastApprovalResult");
    }
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, [messages, pendingApproval]);

  useEffect(() => {
    loadTraces();
  }, []);

  async function loadTraces() {
    try {
      const res = await fetch("/api/traces");
      const data = await res.json();
      setTraces(data.traces || []);
    } catch (e) {
      console.warn("trace fetch failed", e);
    }
  }

  async function send() {
    const prompt = (input || "").trim();
    if (!prompt || busy) return;

    setMessages((m) => [...m, { id: uid(), role: "user", ts: Date.now(), text: prompt }]);
    setInput("");
    setBusy(true);

    try {
      const data = await postJson<InvocationResp>("/invocations", {
        prompt,
        tenant_id: tenantId,
        user_id: userId,
        thread_id: threadId,
        member_id: memberId,
        case_id: caseId,
        assessment_id: assessmentId,
        care_plan_id: carePlanId,
        memory_policy_override: memoryToggles,
      });

      if (!data.ok) {
        setMessages((m) => [
          ...m,
          { id: uid(), role: "system", ts: Date.now(), text: `Error (${data.error.code}): ${data.error.message}` },
        ]);
        return;
      }

      const outputAny = data.output as any;
      const isApproval =
        outputAny?.result === "APPROVAL_REQUIRED" ||
        outputAny?.answer?.result === "APPROVAL_REQUIRED";

      if (isApproval) {
        const rawApproval = outputAny?.approval || outputAny?.answer?.approval;
        const approval = {
          tool_name: rawApproval?.tool_name,
          tool_input: rawApproval?.tool_input,
          message: rawApproval?.message,
          ctx: {
            tenant_id: rawApproval?.ctx?.tenant_id,
            user_id: rawApproval?.ctx?.user_id,
            thread_id: rawApproval?.ctx?.thread_id,
            member_id: rawApproval?.ctx?.member_id,
            case_id: rawApproval?.ctx?.case_id,
            assessment_id: rawApproval?.ctx?.assessment_id,
            care_plan_id: rawApproval?.ctx?.care_plan_id,
            correlation_id: rawApproval?.ctx?.correlation_id,
            run_id: rawApproval?.ctx?.run_id,
            prompt: rawApproval?.ctx?.prompt,
          },
        };
        setPendingApproval(approval);
        setMemoryDebug(data.output);
        setMessages((m) => [
          ...m,
          { id: uid(), role: "assistant", ts: Date.now(), text: "This action requires approval before it can be executed." },
        ]);
        return;
      }

      setMemoryDebug(data.output);
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", ts: Date.now(), text: extractAssistantText(data.output) },
      ]);
      await loadTraces();
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { id: uid(), role: "system", ts: Date.now(), text: `UI Error: ${e?.message || String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([defaultWelcomeMessage()]);
    setPendingApproval(null);
    setTraces([]);
    setMemoryDebug(null);
  }

  function openApprovalConsole() {
    navigate("/supervisor");
  }

  const latestTrace = traces.length > 0 ? traces[0] : null;

  return (
    <div
      className="card"
      style={{
        display: "grid",
        gridTemplateColumns: showTrace ? "1.2fr 0.8fr" : "1fr",
        gap: 16,
        height: "78vh",
      }}
    >
      {/* LEFT: CHAT PANEL */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div className="h1">Nurse Assistant</div>

        {/* context inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 12 }}>
          <input className="input" value={threadId} onChange={(e) => setThreadId(e.target.value)} placeholder="thread_id" />
          <input className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="member_id" />
          <input className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="case_id" />
          <input className="input" value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)} placeholder="assessment_id" />
          <input className="input" value={carePlanId} onChange={(e) => setCarePlanId(e.target.value)} placeholder="care_plan_id" />
        </div>

        {/* CONTEXT BANNER */}
        {memoryDebug?.ctx && <ContextBanner ctx={memoryDebug.ctx} />}

        {/* CHAT HISTORY */}
        <div style={{
          flex: 1,
          marginTop: 12,
          padding: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          overflowY: "auto",
          background: "#0f172a",
        }}>
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isSystem = m.role === "system";
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div style={{
                  maxWidth: "78%",
                  whiteSpace: "pre-wrap",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: isSystem
                    ? "1px solid rgba(239,68,68,0.45)"
                    : isUser
                    ? "1px solid rgba(59,130,246,0.45)"
                    : "1px solid rgba(255,255,255,0.12)",
                  background: isSystem ? "#3f1d1d" : isUser ? "#1d4ed8" : "#1e293b",
                  color: "#f8fafc",
                  fontSize: 14,
                  lineHeight: 1.45,
                }}>
                  {m.text}
                </div>
              </div>
            );
          })}

          {/* HITL config status — shown when flags are loaded */}
          {configFlags !== null && !configFlags.hitl_enabled && (
            <div title="HITL is disabled in agent config. To enable, go to Agent Registry → HITL tab." style={{
              marginTop: 8, padding: "4px 8px",
              background: "rgba(100,116,139,0.15)", border: "1px solid rgba(100,116,139,0.3)",
              borderRadius: 6, fontSize: 11, color: "#94a3b8", cursor: "help",
            }}>
              🔒 HITL disabled in config — approval flow is off
            </div>
          )}

          {pendingApproval && (
            <div style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid rgba(245,158,11,0.6)",
              borderRadius: 10,
              background: "#3b2a11",
              color: "#f8fafc",
            }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Approval Required</div>
              <div><b>Action:</b> {pendingApproval.tool_name}</div>
              <div><b>Assessment:</b> {pendingApproval.tool_input?.assessment_id || pendingApproval.tool_input?.case_id || "-"}</div>
              <div><b>Note:</b> {pendingApproval.tool_input?.note || "-"}</div>
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={openApprovalConsole}>Open Approval Console</button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* INPUT */}
        <textarea
          className="textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type message..."
        />

        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button className="btn" onClick={send} disabled={busy}>{busy ? "Sending..." : "Send"}</button>
          <button className="btn secondary" onClick={clearChat} disabled={busy}>Clear Chat</button>
        </div>
      </div>

      {/* RIGHT: MEMORY + TRACE PANEL */}
      {showTrace && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>

          {/* MEMORY PANEL */}
          <MemoryPanel
            data={memoryDebug || {}}
            showRaw={showRawDebug}
            onToggleRaw={() => setShowRawDebug((v) => !v)}
            toggles={memoryToggles}
            onToggle={(k) => setMemoryToggles((prev) => ({ ...prev, [k]: !prev[k as keyof typeof prev] }))}
            memoryEnabledInConfig={configFlags === null ? true : configFlags.memory_enabled}
          />

          {/* EXECUTION GRAPH */}
          <div style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: 12,
            background: "#020617",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Execution Graph</div>
              <button className="btn secondary" onClick={() => setShowTrace(false)}>Hide</button>
            </div>
            {!latestTrace ? (
              <div style={{ opacity: 0.7, fontSize: 12 }}>No trace yet. Send a message.</div>
            ) : (
              <TraceGraph run={latestTrace} />
            )}
          </div>
        </div>
      )}

      {!showTrace && (
        <button
          className="btn"
          style={{ position: "absolute", right: 20, top: 20 }}
          onClick={() => setShowTrace(true)}
        >
          Show Trace
        </button>
      )}
    </div>
  );
}
