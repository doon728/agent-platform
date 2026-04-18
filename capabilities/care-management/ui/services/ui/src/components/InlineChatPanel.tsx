import React, { useEffect, useRef, useState } from "react";
import { postJson } from "../lib/api";
import TraceGraph from "./TraceGraph";
import SummaryPanel from "./SummaryPanel";

type ChatMsg = { id: string; role: "user" | "assistant" | "system"; text: string; ts: number };
type TraceStep = { type: string; data: any; timestamp: number };
type TraceRun = { run_id: string; agent: string; thread_id: string; prompt: string; steps: TraceStep[]; total_latency_ms?: number };
type InvocationOk = { ok: true; output: any; correlation_id: string };
type InvocationErr = { ok: false; error: { code: string; message: string }; correlation_id?: string };
type InvocationResp = InvocationOk | InvocationErr;
type EpisodicEntry = { content: string; metadata: any };

export interface ChatContext {
  type: "member" | "case" | "assessment";
  id: string;
  label: string;          // e.g. "Mia Martinez" or "Behavioral Health Support"
  memberId?: string;
}

const POLL_MS = 5000;

function uid() { return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }

function extractText(output: unknown): string {
  const o: any = output;
  if (!o) return "No output.";
  if (typeof o === "string") return o;
  if (typeof o?.answer === "string") return o.answer;
  return JSON.stringify(o, null, 2);
}

function getOrCreateThread(type: string, id: string): string {
  const key = `chat-thread:${type}:${id}`;
  let tid = localStorage.getItem(key);
  if (!tid) { tid = `${type}-${id}-${Date.now().toString(16)}`; localStorage.setItem(key, tid); }
  return tid;
}

function loadMessages(type: string, id: string): ChatMsg[] {
  try {
    const raw = localStorage.getItem(`chat-messages:${type}:${id}`);
    return raw ? (JSON.parse(raw) as ChatMsg[]) : [];
  } catch { return []; }
}

function saveMessages(type: string, id: string, msgs: ChatMsg[]) {
  try { localStorage.setItem(`chat-messages:${type}:${id}`, JSON.stringify(msgs)); } catch {}
}

function clearStoredMessages(type: string, id: string) {
  localStorage.removeItem(`chat-messages:${type}:${id}`);
}

// ── Context type icon ─────────────────────────────────────────────────────────
function ContextIcon({ type }: { type: string }) {
  const icons: Record<string, string> = { member: "👤", case: "📋", assessment: "📝" };
  return <span style={{ fontSize: 14 }}>{icons[type] || "💬"}</span>;
}

// ── Memory Panel ──────────────────────────────────────────────────────────────
function MemoryPanel({ data, toggles, onToggle, liveEpisodic, memoryContext }: {
  data: any;
  toggles: Record<string, boolean>;
  onToggle: (k: string) => void;
  liveEpisodic: EpisodicEntry[];
  memoryContext: any;
}) {
  const trace = data?.memory_trace || {};
  const planner = trace.planner || {};
  const router = trace.router || {};
  const executor = trace.executor || {};
  const policyKeys = ["short_term", "episodic", "summary", "semantic"];

  // Merge live episodic into written section: if liveEpisodic has entries, show episodic as written
  const written = {
    ...(trace.written || {}),
    ...(liveEpisodic.length > 0 ? {
      episodic: { status: "written", scope: "case_or_assessment", trigger: "tool_success_post_hitl" }
    } : {}),
  };

  function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
        <span style={{ color: "#64748b", fontSize: 11 }}>{label}</span>
        <span style={{ color: "#0f172a", fontSize: 11, fontFamily: "monospace" }}>{value}</span>
      </div>
    );
  }

  function Sec({ title }: { title: string }) {
    return <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginTop: 10, marginBottom: 3 }}>{title}</div>;
  }

  if (!data && !memoryContext) return <div style={{ color: "#475569", fontSize: 12, padding: 8 }}>No memory data yet. Send a message or click Refresh.</div>;

  return (
    <div style={{ fontSize: 12, padding: "4px 0" }}>
      <Sec title="Memory Scopes" />
      <div style={{ fontSize: 10, color: "#334155", marginBottom: 4 }}>Click to toggle for next message</div>
      {policyKeys.map((k) => {
        const on = !!toggles[k];
        return (
          <div key={k} onClick={() => onToggle(k)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", cursor: "pointer" }}>
            <span style={{ color: "#94a3b8", fontSize: 11 }}>{k}</span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
              background: on ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
              color: on ? "#4ade80" : "#475569",
              border: `1px solid ${on ? "rgba(34,197,94,0.3)" : "rgba(100,116,139,0.2)"}`,
              userSelect: "none",
            }}>{on ? "ON" : "OFF"}</span>
          </div>
        );
      })}

      {memoryContext?.scopes && memoryContext.scopes.length > 0 && (
        <>
          <Sec title="Active Scopes" />
          {memoryContext.scopes.map((s: any, i: number) => (
            <Row key={i} label={s.scope_type} value={<span style={{ fontFamily: "monospace" }}>{s.scope_id}</span>} />
          ))}
        </>
      )}

      {memoryContext?.recent_turns && memoryContext.recent_turns.length > 0 && (
        <>
          <Sec title={`Recent Turns (${memoryContext.recent_turns.length})`} />
          {memoryContext.recent_turns.slice(0, 3).map((t: any, i: number) => (
            <div key={i} style={{ marginBottom: 5, padding: "5px 8px", borderRadius: 5, background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#6366f1", marginBottom: 2 }}>{t.role || "turn"}</div>
              <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", lineHeight: 1.4 }}>
                {String(t.content || t.text || "").slice(0, 120)}{String(t.content || t.text || "").length > 120 ? "…" : ""}
              </div>
            </div>
          ))}
        </>
      )}

      {memoryContext?.episodic_memories && memoryContext.episodic_memories.length > 0 && (
        <>
          <Sec title={`Episodic (${memoryContext.episodic_memories.length})`} />
          {memoryContext.episodic_memories.slice(0, 3).map((entry: any, i: number) => (
            <div key={i} style={{ marginBottom: 5, padding: "5px 8px", borderRadius: 5, background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)" }}>
              <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", lineHeight: 1.4 }}>
                {String(entry.content || "").slice(0, 160)}{String(entry.content || "").length > 160 ? "…" : ""}
              </div>
              {entry.metadata?.tool && <div style={{ fontSize: 10, color: "#6366f1", marginTop: 2 }}>tool: {entry.metadata.tool}</div>}
            </div>
          ))}
        </>
      )}

      {memoryContext?.semantic_memories && memoryContext.semantic_memories.length > 0 && (
        <>
          <Sec title={`Semantic (${memoryContext.semantic_memories.length})`} />
          {memoryContext.semantic_memories.slice(0, 2).map((entry: any, i: number) => (
            <div key={i} style={{ marginBottom: 5, padding: "5px 8px", borderRadius: 5, background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)" }}>
              <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", lineHeight: 1.4 }}>
                {String(entry.content || entry.text || "").slice(0, 120)}…
              </div>
            </div>
          ))}
        </>
      )}

      {planner.route_type && (
        <>
          <Sec title="Planner" />
          <Row label="route" value={
            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
              background: planner.route_type === "HARD_ROUTE" ? "rgba(99,102,241,0.15)" : "rgba(245,158,11,0.15)",
              color: planner.route_type === "HARD_ROUTE" ? "#a5b4fc" : "#fcd34d",
              border: `1px solid ${planner.route_type === "HARD_ROUTE" ? "rgba(99,102,241,0.35)" : "rgba(245,158,11,0.35)"}`,
            }}>{planner.route_type}</span>
          } />
          <Row label="tool" value={planner.tool || "—"} />
          {planner.reason && <div style={{ color: "#475569", fontSize: 10, fontFamily: "monospace", marginTop: 2 }}>{planner.reason}</div>}
        </>
      )}

      {router.tool && (
        <>
          <Sec title="Router" />
          <Row label="tool" value={router.tool} />
          <Row label="mode" value={router.mode || "—"} />
        </>
      )}

      {executor.tool && (
        <>
          <Sec title="Executor" />
          <Row label="tool" value={executor.tool} />
          <Row label="status" value={executor.status || "—"} />
        </>
      )}

      {(written.episodic || written.short_term) && (
        <>
          <Sec title="Written" />
          {written.episodic?.status && <Row label="episodic" value={written.episodic.status} />}
          {written.short_term?.status && <Row label="short_term" value={written.short_term.status} />}
        </>
      )}

      {liveEpisodic.length > 0 && (
        <>
          <Sec title="Episodic Entries" />
          {liveEpisodic.slice(0, 3).map((entry, i) => (
            <div key={i} style={{
              marginBottom: 6, padding: "6px 8px", borderRadius: 6,
              background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
            }}>
              <div style={{ color: "#475569", fontSize: 10, lineHeight: 1.4, fontFamily: "monospace" }}>
                {entry.content.length > 180 ? entry.content.slice(0, 180) + "…" : entry.content}
              </div>
              {entry.metadata?.tool && (
                <div style={{ color: "#6366f1", fontSize: 10, marginTop: 3 }}>tool: {entry.metadata.tool}</div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  context: ChatContext;
  onClose: () => void;
}

export default function InlineChatPanel({ context, onClose }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{
    approval_id: string; tool_name: string; tool_input: any; risk_level: string;
  } | null>(null);
  const [memoryDebug, setMemoryDebug] = useState<any | null>(null);
  const [liveEpisodic, setLiveEpisodic] = useState<EpisodicEntry[]>([]);
  const [memoryContext, setMemoryContext] = useState<any | null>(null);
  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [memoryToggles, setMemoryToggles] = useState({ short_term: true, episodic: true, summary: true, semantic: false });
  const [activeTab, setActiveTab] = useState<"chat" | "memory" | "trace" | "summary">("chat");

  const threadRef = useRef(getOrCreateThread(context.type, context.id));
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevContextId = useRef(context.id);

  // Reset when context switches
  useEffect(() => {
    if (prevContextId.current !== context.id) {
      prevContextId.current = context.id;
      threadRef.current = getOrCreateThread(context.type, context.id);
      setMemoryDebug(null);
      setMemoryContext(null);
      setLiveEpisodic([]);
      setTraces([]);
      setActiveTab("chat");
    }
  }, [context.id, context.type]);

  // Welcome message on mount / context switch — skip if stored history exists
  useEffect(() => {
    const stored = loadMessages(context.type, context.id);
    if (stored.length > 0) {
      setMessages(stored);
    } else {
      setMessages([{
        id: uid(), role: "assistant", ts: Date.now(),
        text: context.type === "member"
          ? `Chatting about member ${context.label}. Ask about their cases, conditions, or care status.`
          : context.type === "case"
          ? `Chatting about case: ${context.label} (${context.id}). Ask about assessments, tasks, or clinical status.`
          : `Chatting about assessment ${context.id}. Ask about concerns, tasks, or findings.`,
      }]);
    }
    loadTraces();
  }, [context.id]);

  // Persist messages to localStorage on every update
  useEffect(() => {
    if (messages.length > 0) saveMessages(context.type, context.id, messages);
  }, [messages]);

  useEffect(() => {
    if (activeTab === "chat") requestAnimationFrame(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); });
  }, [messages, pendingApproval, activeTab]);

  // Build context body for /debug/memory fetch
  function buildContextBody() {
    const body: any = { tenant_id: "t1", thread_id: threadRef.current };
    if (context.type === "assessment") {
      body.assessment_id = context.id;
      if (context.memberId) body.member_id = context.memberId;
    } else if (context.type === "case") {
      body.case_id = context.id;
      if (context.memberId) body.member_id = context.memberId;
    } else {
      body.member_id = context.id;
    }
    return body;
  }

  // Fetch live episodic entries from memory store after HITL approval
  async function fetchLiveEpisodic() {
    try {
      const res = await fetch("/api/debug/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildContextBody()),
      });
      if (!res.ok) return;
      const data = await res.json();
      const episodic: EpisodicEntry[] = (data.memory_context?.episodic_memories || []);
      if (episodic.length > 0) setLiveEpisodic(episodic);
    } catch {}
  }

  useEffect(() => {
    if (!pendingApproval?.approval_id) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/hitl/status/${pendingApproval.approval_id}`);
        if (!res.ok) return;
        const data = await res.json();
        const record = data.approval || data;
        if (record.status === "approved") {
          setMessages((m) => [...m, { id: uid(), role: "assistant", ts: Date.now(), text: `✓ Approved by ${record.decided_by || "supervisor"}.` }]);
          setPendingApproval(null);
          // Fetch live episodic so the memory panel shows what was written post-approval
          await fetchLiveEpisodic();
        } else if (record.status === "rejected") {
          setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `✗ Rejected by ${record.decided_by || "supervisor"}.` }]);
          setPendingApproval(null);
        }
      } catch {}
    };
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [pendingApproval?.approval_id]);

  async function loadTraces() {
    try {
      const res = await fetch("/api/traces");
      const data = await res.json();
      setTraces(data.traces || []);
    } catch {}
  }

  async function refreshMemory() {
    try {
      const res = await fetch("/api/debug/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildContextBody()),
      });
      if (!res.ok) return;
      const data = await res.json();
      setMemoryContext(data.memory_context || null);
      // Do NOT touch memoryDebug — it holds the planner/router/executor trace from the last message
      const episodic: EpisodicEntry[] = data.memory_context?.episodic_memories || [];
      if (episodic.length > 0) setLiveEpisodic(episodic);
    } catch {}
  }

  // Refresh data when switching to memory or trace tab
  useEffect(() => {
    if (activeTab === "memory") refreshMemory();
    if (activeTab === "trace") loadTraces();
  }, [activeTab]);

  async function send() {
    const prompt = (input || "").trim();
    if (!prompt || busy) return;
    setMessages((m) => [...m, { id: uid(), role: "user", ts: Date.now(), text: prompt }]);
    setInput("");
    setBusy(true);

    try {
      const body: any = { prompt, tenant_id: "t1", user_id: "nurse-1", thread_id: threadRef.current, memory_policy_override: memoryToggles };

      if (context.type === "assessment") {
        body.assessment_id = context.id;
        if (context.memberId) body.member_id = context.memberId;
      } else if (context.type === "case") {
        body.case_id = context.id;
        if (context.memberId) body.member_id = context.memberId;
      } else {
        body.member_id = context.id;
      }

      const data = await postJson<InvocationResp>("/invocations", body);

      if (!data.ok) {
        setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `Error (${data.error.code}): ${data.error.message}` }]);
        return;
      }

      const outputAny = (data as InvocationOk).output as any;
      const answerObj = outputAny?.answer ?? outputAny;
      setMemoryDebug(outputAny);
      setLiveEpisodic([]); // reset live episodic on each new turn
      await loadTraces();

      const isApproval =
        answerObj?.result === "APPROVAL_REQUIRED" ||
        (typeof answerObj?.result === "object" && answerObj?.result?.result === "APPROVAL_REQUIRED");

      if (isApproval) {
        const inner = answerObj?.result === "APPROVAL_REQUIRED" ? answerObj : answerObj?.result;
        setPendingApproval({ approval_id: inner?.approval_id, tool_name: inner?.tool_name, tool_input: inner?.tool_input, risk_level: inner?.risk_level });
        setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `⏳ Awaiting supervisor approval for: ${inner?.tool_name}` }]);
      } else {
        setMessages((m) => [...m, { id: uid(), role: "assistant", ts: Date.now(), text: extractText(answerObj) }]);
      }
    } catch (err: any) {
      setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `Error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const latestTrace = traces[0] ?? null;

  return (
    <div style={{
      marginTop: 20,
      border: "1px solid #c7d2fe",
      borderTop: "3px solid #6366f1",
      borderRadius: 12,
      background: "#fafafa",
      overflow: "hidden",
      boxShadow: "0 4px 16px rgba(99,102,241,0.08)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px",
        background: "#eef2ff",
        borderBottom: "1px solid #c7d2fe",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ContextIcon type={context.type} />
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#a5b4fc" }}>
              {context.type === "member" ? "Member Chat" : context.type === "case" ? "Case Chat" : "Assessment Chat"}
            </span>
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>
              {context.label}
            </span>
            <span style={{ fontSize: 10, color: "#334155", fontFamily: "monospace", marginLeft: 6 }}>
              {context.id}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => {
              const newThread = `${context.type}-${context.id}-${Date.now().toString(16)}`;
              localStorage.setItem(`chat-thread:${context.type}:${context.id}`, newThread);
              threadRef.current = newThread;
              clearStoredMessages(context.type, context.id);
              setMessages([{
                id: uid(), role: "assistant", ts: Date.now(),
                text: context.type === "member"
                  ? `Chatting about member ${context.label}. Ask about their cases, conditions, or care status.`
                  : context.type === "case"
                  ? `Chatting about case: ${context.label} (${context.id}). Ask about assessments, tasks, or clinical status.`
                  : `Chatting about assessment ${context.id}. Ask about concerns, tasks, or findings.`,
              }]);
              setMemoryDebug(null);
              setLiveEpisodic([]);
              setTraces([]);
              setActiveTab("chat");
            }}
            style={{ background: "none", border: "1px solid rgba(100,116,139,0.3)", cursor: "pointer", color: "#64748b", fontSize: 11, padding: "2px 8px", borderRadius: 4 }}
          >
            Clear
          </button>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#475569", fontSize: 16, padding: "2px 6px", borderRadius: 4 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", padding: "0 12px", background: "#f8fafc" }}>
        {(["chat", "summary", "memory", "trace"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "7px 14px", fontSize: 12, fontWeight: 600,
              background: "none", border: "none", cursor: "pointer",
              color: activeTab === tab ? "#a5b4fc" : "#475569",
              borderBottom: activeTab === tab ? "2px solid #6366f1" : "2px solid transparent",
              textTransform: "capitalize",
            }}
          >
            {tab}
            {tab === "memory" && memoryDebug && (
              <span style={{ marginLeft: 4, width: 5, height: 5, borderRadius: "50%", background: "#4ade80", display: "inline-block", verticalAlign: "middle" }} />
            )}
            {tab === "trace" && latestTrace && (
              <span style={{ marginLeft: 4, fontSize: 10, color: "#64748b" }}>{traces.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Chat tab */}
      {activeTab === "chat" && (
        <>
          <div style={{ height: 340, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.map((msg) => (
              <div key={msg.id} style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%", padding: "8px 12px",
                borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.role === "user" ? "#4f46e5" : msg.role === "system" ? "rgba(239,68,68,0.08)" : "#f1f5f9",
                color: msg.role === "user" ? "#ffffff" : msg.role === "system" ? "#ef4444" : "#1e293b",
                fontSize: 13, lineHeight: 1.5,
                border: msg.role === "system" ? "1px solid rgba(239,68,68,0.2)" : "none",
                whiteSpace: "pre-wrap",
              }}>
                {msg.text}
              </div>
            ))}
            {pendingApproval && (
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", fontSize: 12, color: "#fcd34d" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Awaiting Approval</div>
                <div style={{ color: "#94a3b8" }}>Tool: <span style={{ color: "#fcd34d", fontFamily: "monospace" }}>{pendingApproval.tool_name}</span></div>
                <div style={{ color: "#94a3b8" }}>Risk: {pendingApproval.risk_level}</div>
              </div>
            )}
            {busy && <div style={{ alignSelf: "flex-start", color: "#475569", fontSize: 12, padding: "4px 8px" }}>Thinking…</div>}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, background: "#f8fafc" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder={`Ask about this ${context.type}…`}
              disabled={busy}
              style={{ flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 13, background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a", outline: "none" }}
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: busy || !input.trim() ? "#e2e8f0" : "#4f46e5",
                border: "1px solid rgba(255,255,255,0.1)",
                color: busy || !input.trim() ? "#94a3b8" : "#fff",
                cursor: busy || !input.trim() ? "not-allowed" : "pointer",
              }}
            >
              Send
            </button>
          </div>
        </>
      )}

      {/* Memory tab */}
      {activeTab === "memory" && (
        <div style={{ height: 380, overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <button
              onClick={refreshMemory}
              style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#eef2ff", border: "1px solid #c7d2fe", color: "#4f46e5", cursor: "pointer" }}
            >
              Refresh
            </button>
          </div>
          <MemoryPanel
            data={memoryDebug}
            toggles={memoryToggles}
            onToggle={(k) => setMemoryToggles((prev) => ({ ...prev, [k]: !prev[k as keyof typeof prev] }))}
            liveEpisodic={liveEpisodic}
            memoryContext={memoryContext}
          />
        </div>
      )}

      {/* Summary tab */}
      {activeTab === "summary" && (
        <div style={{ height: 380, overflowY: "auto", padding: "12px 16px" }}>
          <SummaryPanel
            scopeType={context.type}
            scopeId={context.id}
            memberId={context.memberId}
          />
        </div>
      )}

      {/* Trace tab */}
      {activeTab === "trace" && (
        <div style={{ height: 380, overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <button
              onClick={loadTraces}
              style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#eef2ff", border: "1px solid #c7d2fe", color: "#4f46e5", cursor: "pointer" }}
            >
              Refresh
            </button>
          </div>
          {latestTrace ? (
            <TraceGraph run={latestTrace} />
          ) : (
            <div style={{ color: "#475569", fontSize: 12 }}>No trace yet. Send a message.</div>
          )}
        </div>
      )}
    </div>
  );
}
