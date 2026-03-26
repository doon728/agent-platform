import React, { useEffect, useRef, useState } from "react";
import { postJson } from "../lib/api";
import TraceGraph from "./TraceGraph";

type ChatMsg = { id: string; role: "user" | "assistant" | "system"; text: string; ts: number };
type TraceStep = { type: string; data: any; timestamp: number };
type TraceRun = { run_id: string; agent: string; thread_id: string; prompt: string; steps: TraceStep[]; total_latency_ms?: number };

type InvocationOk = { ok: true; output: any; correlation_id: string };
type InvocationErr = { ok: false; error: { code: string; message: string }; correlation_id?: string };
type InvocationResp = InvocationOk | InvocationErr;

const POLL_MS = 5000;

function uid() { return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }

function extractText(output: unknown): string {
  const o: any = output;
  if (!o) return "No output.";
  if (typeof o === "string") return o;
  if (typeof o?.answer === "string") return o.answer;
  return JSON.stringify(o, null, 2);
}

function getOrCreateThread(contextType: string, contextId: string): string {
  const key = `chat-thread:${contextType}:${contextId}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = `${contextType}-${contextId}-${Date.now().toString(16)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

// ── Memory Panel (compact) ────────────────────────────────────────────────────

function MemoryPanel({ data }: { data: any }) {
  const trace = data?.memory_trace || {};
  const planner = trace.planner || {};
  const router = trace.router || {};
  const executor = trace.executor || {};
  const retrieved = trace.retrieved || {};
  const written = trace.written || {};

  const policyKeys = ["short_term", "episodic", "summary", "semantic"];

  function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
        <span style={{ color: "#94a3b8", fontSize: 11 }}>{label}</span>
        <span style={{ color: "#e2e8f0", fontSize: 11, fontFamily: "monospace" }}>{value}</span>
      </div>
    );
  }

  function SectionHeader({ title }: { title: string }) {
    return <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginTop: 10, marginBottom: 3 }}>{title}</div>;
  }

  if (!data) return <div style={{ color: "#475569", fontSize: 12, padding: 8 }}>No memory data yet. Send a message.</div>;

  return (
    <div style={{ fontSize: 12, overflowY: "auto", padding: "8px 4px" }}>
      <SectionHeader title="Memory Scopes" />
      {policyKeys.map((k) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>{k}</span>
          <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
            background: (trace.scopes || []).includes(k) ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
            color: (trace.scopes || []).includes(k) ? "#4ade80" : "#475569",
            border: `1px solid ${(trace.scopes || []).includes(k) ? "rgba(34,197,94,0.3)" : "rgba(100,116,139,0.2)"}`,
          }}>
            {(trace.scopes || []).includes(k) ? "ON" : "OFF"}
          </span>
        </div>
      ))}

      {planner.route_type && (
        <>
          <SectionHeader title="Planner" />
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
          <SectionHeader title="Router" />
          <Row label="tool" value={router.tool} />
          <Row label="mode" value={router.mode || "—"} />
        </>
      )}

      {executor.tool && (
        <>
          <SectionHeader title="Executor" />
          <Row label="tool" value={executor.tool} />
          <Row label="status" value={executor.status || "—"} />
        </>
      )}

      {(written.episodic || written.short_term) && (
        <>
          <SectionHeader title="Written" />
          {written.episodic?.status && <Row label="episodic" value={written.episodic.status} />}
          {written.short_term?.status && <Row label="short_term" value={written.short_term.status} />}
        </>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  contextType: "assessment" | "case" | "member";
  contextId: string;
  memberId?: string;
  welcomeText?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ChatTriggerButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
        background: open ? "#3730a3" : "#4f46e5",
        border: "none", cursor: "pointer", color: "#fff",
        boxShadow: open ? "none" : "0 2px 8px rgba(79,70,229,0.4)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      {open ? "Close Chat" : "Chat"}
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ChatDrawer({ contextType, contextId, memberId, welcomeText, open, onOpenChange }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{
    approval_id: string; tool_name: string; tool_input: any; risk_level: string;
  } | null>(null);
  const [memoryDebug, setMemoryDebug] = useState<any | null>(null);
  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "memory" | "trace">("chat");

  const threadId = useRef(getOrCreateThread(contextType, contextId));
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ id: uid(), role: "assistant", ts: Date.now(), text: welcomeText || `${contextId} loaded. Ask me anything.` }]);
    }
    if (open) loadTraces();
  }, [open]);

  useEffect(() => {
    if (activeTab === "chat") requestAnimationFrame(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); });
  }, [messages, pendingApproval, activeTab]);

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

  async function send() {
    const prompt = (input || "").trim();
    if (!prompt || busy) return;
    setMessages((m) => [...m, { id: uid(), role: "user", ts: Date.now(), text: prompt }]);
    setInput("");
    setBusy(true);

    try {
      const body: any = { prompt, tenant_id: "t1", user_id: "nurse-1", thread_id: threadId.current };
      if (contextType === "assessment") {
        body.assessment_id = contextId;
        if (memberId) body.member_id = memberId;
      } else if (contextType === "case") {
        body.member_id = memberId || contextId;
      } else {
        body.member_id = contextId;
      }

      const data = await postJson<InvocationResp>("/invocations", body);

      if (!data.ok) {
        setMessages((m) => [...m, { id: uid(), role: "system", ts: Date.now(), text: `Error (${data.error.code}): ${data.error.message}` }]);
        return;
      }

      const outputAny = (data as InvocationOk).output as any;
      const answerObj = outputAny?.answer ?? outputAny;
      setMemoryDebug(outputAny);
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

  const latestTrace = traces.length > 0 ? traces[0] : null;

  return (
    <>
      {open && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 999,
          width: 460, background: "#0f172a",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          display: "flex", flexDirection: "column",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
        }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc" }}>
                {contextType === "assessment" ? "Assessment" : contextType === "case" ? "Case" : "Member"} Chat
              </div>
              <div style={{ fontSize: 11, color: "#475569", fontFamily: "monospace" }}>{contextId}</div>
            </div>
            <button onClick={() => onOpenChange(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 18 }}>✕</button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "0 12px" }}>
            {(["chat", "memory", "trace"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "8px 14px", fontSize: 12, fontWeight: 600,
                  background: "none", border: "none", cursor: "pointer",
                  color: activeTab === tab ? "#a5b4fc" : "#475569",
                  borderBottom: activeTab === tab ? "2px solid #6366f1" : "2px solid transparent",
                  textTransform: "capitalize",
                }}
              >
                {tab}
                {tab === "memory" && memoryDebug && <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />}
                {tab === "trace" && latestTrace && <span style={{ marginLeft: 4, fontSize: 10, color: "#64748b" }}>{traces.length}</span>}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "chat" && (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.map((msg) => (
                  <div key={msg.id} style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "88%", padding: "8px 12px",
                    borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: msg.role === "user" ? "#4f46e5" : msg.role === "system" ? "rgba(239,68,68,0.1)" : "#1e293b",
                    color: msg.role === "system" ? "#f87171" : "#f8fafc",
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
              <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 8 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                  placeholder="Ask a question…"
                  disabled={busy}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 13, background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", color: "#f8fafc", outline: "none" }}
                />
                <button
                  onClick={send}
                  disabled={busy || !input.trim()}
                  style={{
                    padding: "8px 14px", borderRadius: 8, fontSize: 13,
                    background: busy || !input.trim() ? "#1e293b" : "#4f46e5",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: busy || !input.trim() ? "#475569" : "#fff",
                    cursor: busy || !input.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}

          {activeTab === "memory" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
              <MemoryPanel data={memoryDebug} />
            </div>
          )}

          {activeTab === "trace" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
              {latestTrace ? (
                <TraceGraph run={latestTrace} />
              ) : (
                <div style={{ color: "#475569", fontSize: 12 }}>No trace yet. Send a message.</div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
