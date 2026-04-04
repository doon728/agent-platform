import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { postJson } from "../../lib/api";
import TraceGraph from "../../components/TraceGraph";
import SummaryPanel from "../../components/SummaryPanel";

const TOOL_GATEWAY = "http://localhost:8080";
const POLL_APPROVAL_MS = 5000;

// ── Types ─────────────────────────────────────────────────────────────────────

type InvocationOk = { ok: true; output: any; correlation_id: string };
type InvocationErr = { ok: false; error: { code: string; message: string }; correlation_id?: string };
type InvocationResp = InvocationOk | InvocationErr;

type ChatMsg = { id: string; role: "user" | "assistant" | "system"; text: string; ts: number };
type TraceStep = { type: string; data: any; timestamp: number };
type TraceRun = { run_id: string; agent: string; thread_id: string; prompt: string; steps: TraceStep[]; total_latency_ms?: number };

function uid() { return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }

function extractAssistantText(output: unknown): string {
  const o: any = output;
  if (!o) return "No output.";
  if (typeof o === "string") return o;
  if (typeof o?.answer === "string") return o.answer;
  return JSON.stringify(o, null, 2);
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginTop: 12, marginBottom: 4 }}>
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
      fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
      background: on ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
      color: on ? "#4ade80" : "#f87171",
      border: `1px solid ${on ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
    }}>
      {on ? "ON" : "OFF"}
    </span>
  );
}

function PlannerRouteBadge({ routeType }: { routeType: string }) {
  const isHard = routeType === "HARD_ROUTE";
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
      background: isHard ? "rgba(99,102,241,0.15)" : "rgba(245,158,11,0.15)",
      color: isHard ? "#a5b4fc" : "#fcd34d",
      border: `1px solid ${isHard ? "rgba(99,102,241,0.35)" : "rgba(245,158,11,0.35)"}`,
      fontFamily: "monospace",
    }}>
      {routeType || "—"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    OPEN:      { bg: "rgba(34,197,94,0.15)",  color: "#4ade80", border: "rgba(34,197,94,0.3)" },
    COMPLETED: { bg: "rgba(99,102,241,0.15)", color: "#818cf8", border: "rgba(99,102,241,0.3)" },
    PENDING:   { bg: "rgba(251,191,36,0.15)", color: "#fcd34d", border: "rgba(251,191,36,0.3)" },
    ACTIVE:    { bg: "rgba(34,197,94,0.15)",  color: "#4ade80", border: "rgba(34,197,94,0.3)" },
    COMPLETE:  { bg: "rgba(99,102,241,0.15)", color: "#818cf8", border: "rgba(99,102,241,0.3)" },
    SCHEDULED: { bg: "rgba(251,191,36,0.15)", color: "#fcd34d", border: "rgba(251,191,36,0.3)" },
  };
  const c = colors[status] || { bg: "rgba(100,116,139,0.2)", color: "#94a3b8", border: "rgba(100,116,139,0.3)" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {status}
    </span>
  );
}

// ── Memory Panel ──────────────────────────────────────────────────────────────

function MemoryPanel({ data, showRaw, onToggleRaw, toggles, onToggle }: {
  data: any; showRaw: boolean; onToggleRaw: () => void;
  toggles: Record<string, boolean>; onToggle: (key: string) => void;
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
    <div style={{ background: "#020617", border: "1px solid #334155", borderRadius: 10, padding: 12, fontSize: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: "#f8fafc", marginBottom: 4 }}>Memory Panel</div>

      <SectionHeader title="Policy" />
      {policyKeys.map((k) => (
        <div key={k} onClick={() => onToggle(k)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", cursor: "pointer" }}>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>{k}</span>
          <Badge on={!!toggles[k]} />
        </div>
      ))}

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
                <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)", fontFamily: "monospace" }}>episodic</span>
              )}
            </span>
          </div>
          <div style={{ paddingLeft: 0, marginTop: 2, marginBottom: 4 }}>
            <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>{planner.reason || ""}</span>
          </div>
          {planner.active_assessment_id && <Row label="assessment used" value={planner.active_assessment_id} />}
          {planner.route_type === "LLM_ROUTE" && planner.llm_raw && (
            <div style={{ paddingLeft: 0, marginTop: 2 }}>
              <span style={{ color: "#334155", fontSize: 10, fontFamily: "monospace" }}>llm said: </span>
              <span style={{ color: "#475569", fontSize: 10, fontFamily: "monospace" }}>{planner.llm_raw}</span>
            </div>
          )}
        </>
      )}

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

      <SectionHeader title="Scopes Resolved" />
      {scopes.length === 0 ? <div style={{ color: "#475569", fontSize: 11 }}>none</div> : scopes.map((s: any) => (
        <Row key={s.scope_type} label={s.scope_type} value={s.scope_id} />
      ))}

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

      <SectionHeader title="Written" />
      {Object.keys(written).length === 0 ? (
        <div style={{ color: "#475569", fontSize: 11 }}>none</div>
      ) : Object.entries(written).map(([k, v]: [string, any]) => (
        <Row key={k} label={k} value={v.status || "-"} />
      ))}

      {Object.keys(skipped).length > 0 && (
        <>
          <SectionHeader title="Skipped" />
          {Object.entries(skipped).map(([k, v]: [string, any]) => (
            <Row key={k} label={k} value={v.reason || "-"} />
          ))}
        </>
      )}

      <SectionHeader title="Context Assembly" />
      <Row label="prefer_summaries" value={String(assembly.prefer_summaries_over_raw ?? "-")} />
      <Row label="deduplicate" value={String(assembly.deduplicate ?? "-")} />
      <Row label="max_items" value={String(assembly.max_total_items ?? "-")} />

      <div style={{ marginTop: 10, borderTop: "1px solid #1e293b", paddingTop: 8 }}>
        <button onClick={onToggleRaw} style={{ fontSize: 11, color: "#475569", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {showRaw ? "▼" : "▶"} Technical Details
        </button>
        {showRaw && (
          <pre style={{ marginTop: 6, color: "#64748b", overflow: "auto", maxHeight: 300, fontSize: 10, lineHeight: 1.4 }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Task List ─────────────────────────────────────────────────────────────────

function TaskList({ tasks }: { tasks: any[] }) {
  const phases = ["pre_call", "during_call", "post_call"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {phases.map((phase) => {
        const phaseTasks = tasks.filter((t) => t.phase === phase);
        if (phaseTasks.length === 0) return null;
        return (
          <div key={phase}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, marginTop: 8 }}>
              {phase.replace("_", " ")}
            </div>
            {phaseTasks.map((t) => (
              <div key={t.task_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0f172a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, marginBottom: 4 }}>
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${t.status === "COMPLETED" ? "#4ade80" : "rgba(255,255,255,0.2)"}`, background: t.status === "COMPLETED" ? "rgba(34,197,94,0.2)" : "transparent", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {t.status === "COMPLETED" && <span style={{ fontSize: 8, color: "#4ade80" }}>✓</span>}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: t.status === "COMPLETED" ? "#475569" : "#f8fafc", textDecoration: t.status === "COMPLETED" ? "line-through" : "none" }}>
                    {t.title}
                  </div>
                  {t.due_date && <div style={{ fontSize: 11, color: "#475569" }}>Due: {t.due_date}</div>}
                </div>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AssessmentView() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  // Assessment data
  const [assessment, setAssessment] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Chat state
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const pendingKey = `asmt:${assessmentId}:pendingApproval`;
  const [pendingApproval, setPendingApproval] = useState<{
    approval_id: string;
    tool_name: string;
    tool_input: any;
    risk_level: string;
  } | null>(() => {
    try { return JSON.parse(localStorage.getItem(`asmt:${assessmentId}:pendingApproval`) || "null"); } catch { return null; }
  });

  // Context
  const [tenantId] = useState("t1");
  const [userId] = useState("nurse-1");
  const [threadId] = useState(() => `asmt-${assessmentId}-${Date.now().toString(16)}`);

  // Memory / trace
  const [memoryDebug, setMemoryDebug] = useState<any | null>(null);
  const [showRawDebug, setShowRawDebug] = useState(false);
  const [memoryToggles, setMemoryToggles] = useState({ short_term: true, episodic: true, summary: true, semantic: false });
  const [hitlEnabled, setHitlEnabled] = useState(true);
  const [showAgentConfig, setShowAgentConfig] = useState(true);
  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [showTrace, setShowTrace] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!assessmentId) return;
    Promise.all([
      fetch(`${TOOL_GATEWAY}/assessments/${assessmentId}`).then((r) => r.json()),
      fetch(`${TOOL_GATEWAY}/assessments/${assessmentId}/tasks`).then((r) => r.json()),
    ]).then(([aData, tData]) => {
      // API returns {ok, assessment: {found, assessment: {...inner...}, member, ...}}
      // Extract the inner assessment record so assessment.case_id, assessment_type etc. work
      setAssessment(aData.assessment?.assessment || null);
      setTasks(tData.tasks || []);
      setMessages([{ id: uid(), role: "assistant", ts: Date.now(), text: `Assessment ${assessmentId} loaded. Ask me to summarize, write a case note, or review tasks.` }]);
    }).finally(() => setLoading(false));
    loadTraces();
  }, [assessmentId]);

  // Persist pendingApproval to localStorage scoped to this assessment
  useEffect(() => {
    if (pendingApproval) {
      localStorage.setItem(pendingKey, JSON.stringify(pendingApproval));
    } else {
      localStorage.removeItem(pendingKey);
    }
  }, [pendingApproval]);

  // Poll HITL status when an approval is pending
  useEffect(() => {
    if (!pendingApproval?.approval_id) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/hitl/status/${pendingApproval.approval_id}`);
        if (!res.ok) return;
        const data = await res.json();
        const record = data.approval || data;
        if (record.status === "approved") {
          setMessages((m) => [...m, { id: uid(), role: "assistant", ts: Date.now(), text: `✓ Action approved by ${record.decided_by || "supervisor"}.${record.decision_reason ? ` Reason: ${record.decision_reason}` : ""}` }]);
          setPendingApproval(null);
        } else if (record.status === "rejected") {
          setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `✗ Action rejected by ${record.decided_by || "supervisor"}.${record.decision_reason ? ` Reason: ${record.decision_reason}` : ""}` }]);
          setPendingApproval(null);
        }
      } catch {}
    };
    const t = setInterval(poll, POLL_APPROVAL_MS);
    return () => clearInterval(t);
  }, [pendingApproval?.approval_id]);

  useEffect(() => {
    requestAnimationFrame(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); });
  }, [messages, pendingApproval]);

  async function loadTraces() {
    try {
      const res = await fetch("/api/traces");
      const data = await res.json();
      setTraces(data.traces || []);
    } catch {}
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
        assessment_id: assessmentId,
        memory_policy_override: memoryToggles,
        hitl_override: { enabled: hitlEnabled },
      });

      if (!data.ok) {
        setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `Error (${data.error.code}): ${data.error.message}` }]);
        return;
      }

      const outputAny = data.output as any;
      const answerObj = outputAny?.answer ?? outputAny;
      const isApproval =
        answerObj?.result === "APPROVAL_REQUIRED" ||
        (typeof answerObj?.result === "object" && answerObj?.result?.result === "APPROVAL_REQUIRED");

      if (isApproval) {
        const inner = answerObj?.result === "APPROVAL_REQUIRED" ? answerObj : answerObj?.result;
        setPendingApproval({
          approval_id: inner?.approval_id || "",
          tool_name: inner?.tool_name || "",
          tool_input: inner?.tool_input || {},
          risk_level: inner?.risk_level || "high",
        });
        setMemoryDebug(data.output);
        setMessages((m) => [...m, { id: uid(), role: "assistant", ts: Date.now(), text: inner?.answer || "This action requires supervisor approval before it can be executed." }]);
        return;
      }

      setMemoryDebug(data.output);
      setMessages((m) => [...m, { id: uid(), role: "assistant", ts: Date.now(), text: extractAssistantText(data.output) }]);
      await loadTraces();
    } catch (e: any) {
      setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `UI Error: ${e?.message || String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([{ id: uid(), role: "assistant", ts: Date.now(), text: `Assessment ${assessmentId} loaded. Ask me to summarize, write a case note, or review tasks.` }]);
    setPendingApproval(null);
    setMemoryDebug(null);
    setTraces([]);
  }

  if (loading) return <div className="card" style={{ color: "#64748b" }}>Loading...</div>;
  if (!assessment) return <div className="card" style={{ color: "#f87171" }}>Assessment not found.</div>;

  const completedCount = tasks.filter((t) => t.status === "COMPLETED").length;
  const latestTrace = traces.length > 0 ? traces[0] : null;

  return (
    <div className="card" style={{ display: "grid", gridTemplateColumns: showTrace ? "1fr 1fr 0.85fr" : "1fr 1fr", gap: 16, height: "82vh" }}>

      {/* ── LEFT: Assessment Detail + Tasks ── */}
      <div style={{ display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <button className="btn secondary" style={{ marginBottom: 12, fontSize: 12, alignSelf: "flex-start" }} onClick={() => navigate(`/cases/${assessment.case_id || ""}`)}>
          ← Back to Case
        </button>

        <SummaryPanel
          scopeType="assessment"
          scopeId={assessmentId!}
          tenantId={tenantId}
        />

        {/* Header */}
        <div style={{ padding: "14px 16px", background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{assessment.assessment_type}</div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 4, display: "flex", gap: 10 }}>
                <span>{assessment.assessment_id}</span>
                <span>Created: {assessment.created_at?.slice(0, 10)}</span>
                {assessment.priority && <span>Priority: {assessment.priority}</span>}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <StatusBadge status={assessment.status} />
              {assessment.overall_risk_level && <span style={{ fontSize: 11, color: "#94a3b8" }}>Risk: {assessment.overall_risk_level}</span>}
            </div>
          </div>
          {assessment.summary && <div style={{ marginTop: 10, fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{assessment.summary}</div>}
        </div>

        {/* Tasks */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#f8fafc" }}>Tasks ({completedCount}/{tasks.length})</div>
          <div style={{ width: 100, height: 5, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 3, width: tasks.length > 0 ? `${(completedCount / tasks.length) * 100}%` : "0%", background: completedCount === tasks.length ? "#4ade80" : "#6366f1", transition: "width 0.3s" }} />
          </div>
        </div>
        <TaskList tasks={tasks} />
      </div>

      {/* ── MIDDLE: Chat Panel ── */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc", marginBottom: 8 }}>
          Chat · <span style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 12 }}>{assessmentId}</span>
        </div>

        {/* Chat history */}
        <div style={{ flex: 1, padding: 12, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, overflowY: "auto", background: "#0f172a" }}>
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isSystem = m.role === "system";
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div style={{
                  maxWidth: "85%", whiteSpace: "pre-wrap", padding: "10px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.45,
                  border: isSystem ? "1px solid rgba(239,68,68,0.45)" : isUser ? "1px solid rgba(59,130,246,0.45)" : "1px solid rgba(255,255,255,0.12)",
                  background: isSystem ? "#3f1d1d" : isUser ? "#1d4ed8" : "#1e293b",
                  color: "#f8fafc",
                }}>
                  {m.text}
                </div>
              </div>
            );
          })}

          {pendingApproval && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid rgba(245,158,11,0.6)", borderRadius: 10, background: "#3b2a11", color: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>⏳ Awaiting Supervisor Approval</div>
                <span style={{ fontSize: 10, fontFamily: "monospace", color: "#94a3b8" }}>{pendingApproval.approval_id}</span>
              </div>
              <div style={{ fontSize: 13 }}><b>Action:</b> {pendingApproval.tool_name} · <b>Risk:</b> {pendingApproval.risk_level}</div>
              {pendingApproval.tool_input?.note && (
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Note: {pendingApproval.tool_input.note}</div>
              )}
              <div style={{ fontSize: 11, color: "#78716c", marginTop: 8 }}>
                A supervisor will review this in the Approval Console. You'll be notified here when a decision is made.
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type message..." style={{ marginTop: 8 }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); send(); } }} />
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button className="btn" onClick={send} disabled={busy}>{busy ? "Sending..." : "Send"}</button>
          <button className="btn secondary" onClick={clearChat} disabled={busy}>Clear</button>
        </div>
      </div>

      {/* ── RIGHT: Memory + Trace + Agent Config ── */}
      {showTrace && (
        <div style={{ display: "flex", gap: 10, overflowY: "auto" }}>

          {/* Memory + Graph column */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            {memoryDebug && (
              <MemoryPanel
                data={memoryDebug}
                showRaw={showRawDebug}
                onToggleRaw={() => setShowRawDebug((v) => !v)}
                toggles={memoryToggles}
                onToggle={(k) => setMemoryToggles((prev) => ({ ...prev, [k]: !prev[k as keyof typeof prev] }))}
              />
            )}
            {!memoryDebug && (
              <div style={{ background: "#020617", border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#f8fafc", marginBottom: 8 }}>Memory Panel</div>
                <div style={{ color: "#475569", fontSize: 12 }}>Send a message to see memory trace.</div>
              </div>
            )}
            <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 12, background: "#020617" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Execution Graph</div>
                <button className="btn secondary" onClick={() => setShowTrace(false)}>Hide</button>
              </div>
              {!latestTrace ? (
                <div style={{ opacity: 0.7, fontSize: 12 }}>No trace yet.</div>
              ) : (
                <TraceGraph run={latestTrace} />
              )}
            </div>
          </div>

          {/* Agent Config column */}
          {showAgentConfig && (
            <div style={{ width: 150, flexShrink: 0 }}>
              <div style={{ background: "#020617", border: "1px solid #334155", borderRadius: 10, padding: 12, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#f8fafc" }}>Agent Config</div>
                  <button onClick={() => setShowAgentConfig(false)} style={{ fontSize: 11, color: "#475569", background: "none", border: "none", cursor: "pointer" }}>Hide</button>
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>HITL</div>
                <div
                  onClick={() => setHitlEnabled((v) => !v)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", cursor: "pointer" }}
                >
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>enabled</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                    background: hitlEnabled ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                    color: hitlEnabled ? "#4ade80" : "#f87171",
                    border: `1px solid ${hitlEnabled ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                  }}>
                    {hitlEnabled ? "ON" : "OFF"}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#334155", marginTop: 8 }}>Session only · resets on refresh</div>
              </div>
            </div>
          )}
          {!showAgentConfig && (
            <button className="btn secondary" style={{ fontSize: 11, alignSelf: "flex-start" }} onClick={() => setShowAgentConfig(true)}>Config</button>
          )}
        </div>
      )}

      {!showTrace && (
        <button className="btn" style={{ position: "absolute", right: 20, top: 20 }} onClick={() => setShowTrace(true)}>
          Show Trace
        </button>
      )}
    </div>
  );
}
