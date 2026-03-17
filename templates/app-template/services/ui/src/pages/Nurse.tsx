import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { postJson } from "../lib/api";
import TraceGraph from "../components/TraceGraph";

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

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function defaultWelcomeMessage(): ChatMsg {
  return {
    id: uid(),
    role: "assistant",
    ts: Date.now(),
    text:
      "Hi — I’m the Nurse assistant.\n\nTry one of these:\n• For assessment asmt-000001 summarize status and latest note\n• What is the patient name?\n• Write a case note for assessment asmt-000001: Member is stable",
  };
}

function extractAssistantText(output: unknown): string {
  const o: any = output;

  if (!o) return "No output.";
  if (typeof o === "string") return o;
  if (typeof o?.answer === "string") return o.answer;

  return JSON.stringify(o, null, 2);
}

export default function Nurse() {
  const navigate = useNavigate();

  const [tenantId, setTenantId] = useState(
    () => localStorage.getItem(STORAGE_TENANT) || "t1"
  );
  const [userId, setUserId] = useState(
    () => localStorage.getItem(STORAGE_USER) || "u1"
  );
  const [threadId, setThreadId] = useState(
    () => localStorage.getItem(STORAGE_THREAD) || "th-1"
  );

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

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_TENANT, tenantId);
    localStorage.setItem(STORAGE_USER, userId);
    localStorage.setItem(STORAGE_THREAD, threadId);
  }, [tenantId, userId, threadId]);

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

    const userMsg: ChatMsg = {
      id: uid(),
      role: "user",
      ts: Date.now(),
      text: prompt,
    };

    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);

    try {
      const data = await postJson<InvocationResp>("/invocations", {
        prompt,
        tenant_id: tenantId,
        user_id: userId,
        thread_id: threadId,
      });

      if (!data.ok) {
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "system",
            ts: Date.now(),
            text: `Error (${data.error.code}): ${data.error.message}`,
          },
        ]);
        return;
      }

      if ((data.output as any)?.result === "APPROVAL_REQUIRED") {
        const approval = (data.output as any).approval;
        setPendingApproval(approval);

        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            ts: Date.now(),
            text:
              "This action requires approval before it can be executed.",
          },
        ]);

        return;
      }

      const assistantText = extractAssistantText(data.output);

      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", ts: Date.now(), text: assistantText },
      ]);

      await loadTraces();
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "system",
          ts: Date.now(),
          text: `UI Error: ${e?.message || String(e)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setMessages([defaultWelcomeMessage()]);
    setPendingApproval(null);
    setTraces([]);   // clear execution graph
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
      {/* CHAT PANEL */}

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div className="h1">Nurse Assistant</div>

        {/* chat controls remain unchanged */}

        {/* CHAT HISTORY */}
        <div
          style={{
            flex: 1,
            marginTop: 12,
            padding: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            overflowY: "auto",
            background: "#0f172a",
          }}
        >
        {messages.map((m) => {
          const isUser = m.role === "user";
          const isSystem = m.role === "system";

          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                marginBottom: 10,
              }}
            >
              <div
                style={{
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
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}

          {pendingApproval && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid rgba(245,158,11,0.6)",
                borderRadius: 10,
                background: "#3b2a11",
                color: "#f8fafc",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                Approval Required
              </div>

              <div>
                <b>Action:</b> {pendingApproval.tool_name}
              </div>

              <div>
                <b>Assessment:</b>{" "}
                {pendingApproval.tool_input?.assessment_id ||
                  pendingApproval.tool_input?.case_id ||
                  "-"}
              </div>

              <div>
                <b>Note:</b> {pendingApproval.tool_input?.note || "-"}
              </div>

              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={openApprovalConsole}>
                  Open Approval Console
                </button>
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
          <button className="btn" onClick={send} disabled={busy}>
            {busy ? "Sending..." : "Send"}
          </button>

          <button className="btn secondary" onClick={clearChat} disabled={busy}>
            Clear Chat
          </button>
        </div>
      </div>

      {/* TRACE PANEL */}

      {showTrace && (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: 12,
            background: "#020617",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              Execution Graph
            </div>

            <button
              className="btn secondary"
              onClick={() => setShowTrace(false)}
            >
              Hide
            </button>
          </div>

          {!latestTrace ? (
            <div style={{ opacity: 0.7 }}>
              No trace yet. Send a message.
            </div>
          ) : (
            <TraceGraph run={latestTrace} />
          )}
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