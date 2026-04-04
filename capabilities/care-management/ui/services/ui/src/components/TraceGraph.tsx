import React, { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

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

function esc(s: string): string {
  return String(s ?? "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .replace(/:/g, " - ")
    .replace(/\{/g, "")
    .replace(/\}/g, "")
    .replace(/\[/g, "")
    .replace(/\]/g, "")
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");
}

export default function TraceGraph({ run }: { run: TraceRun | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visibleSteps, setVisibleSteps] = useState(0);

  const graphId = useMemo(() => {
    return `trace_${run?.run_id || "empty"}_${Date.now()}`;
  }, [run?.run_id]);

  // animate steps
  useEffect(() => {
    if (!run) return;

    setVisibleSteps(0);

    let i = 0;
    const timer = setInterval(() => {
      i++;
      setVisibleSteps(i);
      if (i >= run.steps.length) clearInterval(timer);
    }, 350);

    return () => clearInterval(timer);
  }, [run]);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      flowchart: { curve: "basis" },
    });

    if (!ref.current) return;

    if (!run) {
      ref.current.innerHTML = `<div style="opacity:.7">No trace yet.</div>`;
      return;
    }

    const lines: string[] = [];

    lines.push("flowchart TD");

    lines.push(`A["User Prompt\\n${esc(run.prompt)}"]`);

    let prev = "A";

    run.steps.slice(0, visibleSteps).forEach((s, i) => {
      const id = `N${i}`;
      const stepNum = i + 1;
      let label = "";

      if (s.type === "planner") {
        label = `${stepNum} Planner Decision\\n${esc(
          typeof s.data === "string" ? s.data : JSON.stringify(s.data)
        )}`;
      } 
      else if (s.type === "tool_call") {
        const tool = s?.data?.tool || "tool";
        const input = JSON.stringify(s?.data?.input || {});
        label = `${stepNum} Tool Call\\n${esc(tool)}\\n${esc(input)}`;
      } 
      else if (s.type === "llm_response") {
        const tool = s?.data?.tool || "";
        label = `${stepNum} LLM Response\\n${esc(tool)}`;
      } 
      else {
        label = `${esc(s.type)}\\n${esc(JSON.stringify(s.data))}`;
      }

      lines.push(`${id}["${label}"]`);
      lines.push(`${prev} --> ${id}`);
      prev = id;
    });

    if (visibleSteps >= run.steps.length && run.total_latency_ms) {
      const latencyNode = "LAT";
      lines.push(
        `${latencyNode}["${run.steps.length + 1} Total Latency\\n${run.total_latency_ms} ms"]`
      );
      lines.push(`${prev} --> ${latencyNode}`);
    }

    const graph = lines.join("\n");

    mermaid.render(graphId, graph).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg;
    });
  }, [run, visibleSteps, graphId]);

  return <div ref={ref} />;
}