import { useEffect, useState, useCallback } from "react"
import {
  Box, Typography, CircularProgress, Chip, Divider, Tabs, Tab,
  TextField, Button, Switch, FormControlLabel, IconButton, Alert,
  Table, TableBody, TableCell, TableHead, TableRow, Select, MenuItem,
  InputLabel, FormControl, Tooltip, Paper, ListItemButton,
  ListItemText, Collapse,
} from "@mui/material"
import AddIcon from "@mui/icons-material/Add"
import DeleteIcon from "@mui/icons-material/Delete"
import RefreshIcon from "@mui/icons-material/Refresh"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import LockIcon from "@mui/icons-material/Lock"
import { getAgentStatus, getAgentConfig, patchAgentConfig, getAgentManifest, getGatewayTools } from "../api/factoryApi"

interface AgentRecord {
  capability_name: string
  usecase_name: string
  agent_type: string
  agent_repo_name: string
  app_repo_name: string
  status: "running" | "stopped" | "unknown"
  runtime_url: string
  features: Record<string, boolean>
  locked_features: string[]
}

interface AgentConfig {
  agent: any
  memory: any
  prompts: any
}

const RISK_LEVELS = ["low", "medium", "high"]

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = status === "running" ? "#22c55e" : "#94a3b8"
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />
      <Typography variant="caption" sx={{ color, fontWeight: 600 }}>{status}</Typography>
    </Box>
  )
}

// ── Tab panels ────────────────────────────────────────────────────────────────

const DIM2_COLORS: Record<string, string> = {
  naive: "#6366f1", advanced: "#f59e0b", multi_hop: "#ec4899", agentic: "#10b981", self_rag: "#ef4444",
}

// ── Live Flow Diagram ─────────────────────────────────────────────────────────

interface FlowNodeProps {
  label: string
  sublabel?: string
  active?: boolean
  color?: string
  tag?: string
  nodeKey: string
  onHover: (key: string) => void
}

function FlowNode({ label, sublabel, active = true, color = "#6366f1", tag, nodeKey, onHover }: FlowNodeProps) {
  return (
    <Box
      onMouseEnter={() => onHover(nodeKey)}
      sx={{
        px: 2, py: 1.5, borderRadius: 2, border: "2px solid", cursor: "default",
        borderColor: active ? color : "#e2e8f0",
        bgcolor: active ? `${color}10` : "#f9fafb",
        minWidth: 130, textAlign: "center", position: "relative",
        transition: "box-shadow 0.15s",
        "&:hover": { boxShadow: `0 0 0 3px ${active ? color : "#94a3b8"}33` },
      }}
    >
      {tag && (
        <Box sx={{
          position: "absolute", top: -10, right: 8,
          bgcolor: active ? color : "#94a3b8", color: "white",
          fontSize: 9, fontWeight: 700, px: 0.8, py: 0.2, borderRadius: 1,
          letterSpacing: 0.5, textTransform: "uppercase",
        }}>{tag}</Box>
      )}
      <Typography fontSize={12} fontWeight={700} color={active ? color : "text.disabled"}>
        {label}
      </Typography>
      {sublabel && (
        <Typography fontSize={11} color={active ? "text.secondary" : "text.disabled"} sx={{ mt: 0.3, lineHeight: 1.4 }}>
          {sublabel}
        </Typography>
      )}
    </Box>
  )
}

function FlowArrow({ label, active = true }: { label?: string; active?: boolean }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mx: 0.5, flexShrink: 0 }}>
      {label && <Typography fontSize={10} color={active ? "text.secondary" : "text.disabled"} sx={{ mb: 0.3 }}>{label}</Typography>}
      <Box sx={{ fontSize: 18, color: active ? "#94a3b8" : "#e2e8f0", lineHeight: 1 }}>→</Box>
    </Box>
  )
}

function FlowLoopArrow() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mx: 0.5 }}>
      <Typography fontSize={10} color="#6366f1" sx={{ mb: 0.3 }}>loop</Typography>
      <Box sx={{ fontSize: 18, color: "#6366f1", lineHeight: 1 }}>↺</Box>
    </Box>
  )
}

interface FlowBranchProps {
  label: string
  active: boolean
  nodeKey: string
  onHover: (key: string) => void
}

function FlowBranch({ label, active, nodeKey, onHover }: FlowBranchProps) {
  return (
    <Box
      onMouseEnter={() => onHover(nodeKey)}
      sx={{
        px: 2, py: 1.5, borderRadius: 2, border: "1.5px dashed", cursor: "default",
        borderColor: active ? "#14b8a6" : "#e2e8f0",
        bgcolor: active ? "#f0fdfa" : "#fafafa",
        textAlign: "center", minWidth: 130,
        transition: "box-shadow 0.15s",
        "&:hover": { boxShadow: active ? "0 0 0 3px #14b8a633" : "0 0 0 3px #94a3b833" },
      }}
    >
      <Typography fontSize={12} fontWeight={700} color={active ? "#0f766e" : "text.disabled"}>{label}</Typography>
    </Box>
  )
}

// ── Dynamic help content generators ──────────────────────────────────────────

function buildFlowHelp(config: AgentConfig, agentType: string): Record<string, { title: string; body: string; example?: string }> {
  const agentCfg  = config.agent  || {}
  const memoryCfg = config.memory || {}

  const ragEnabled    = agentCfg?.retrieval?.enabled !== false
  const preGraphOn    = ragEnabled && agentCfg?.retrieval?.pre_graph?.enabled === true
  const plannerToolOn = ragEnabled && agentCfg?.retrieval?.planner_tool?.enabled !== false
  const hitlOn        = agentCfg?.features?.hitl === true
  const memoryOn      = agentCfg?.features?.memory === true
  const strategy      = agentCfg?.reasoning?.strategy || "simple"

  const episodicWriteOn = memoryOn && memoryCfg?.write_policies?.episodic?.enabled === true
  const semanticWriteOn = memoryOn && memoryCfg?.write_policies?.semantic?.enabled === true
  const shortTermOn     = memoryOn && memoryCfg?.write_policies?.short_term?.enabled !== false

  return {
    user_message: {
      title: "User Message",
      body: "The incoming user message that starts the agent turn. This is the raw input from the nurse or user — it gets preprocessed (token check, scope injection) before being passed downstream.",
    },
    pre_graph_rag: {
      title: "Pre-Graph RAG",
      body: preGraphOn
        ? `Currently ENABLED. KB chunks are retrieved BEFORE the planner runs and silently injected into context. The planner sees this content automatically — no explicit tool call needed.\n\nStrategy: ${agentCfg?.retrieval?.pre_graph?.strategy || "hybrid"} · Pattern: ${agentCfg?.retrieval?.pre_graph?.pattern || "naive"} · Top K: ${agentCfg?.retrieval?.pre_graph?.top_k || 3}`
        : "Currently DISABLED. Enable in the RAG tab → Pre-Graph section.\n\nWhen enabled: KB chunks are retrieved before the planner runs and injected silently into context. Recommended for chat_agent when the planner should always have relevant KB context.",
      example: preGraphOn
        ? "Nurse asks about a prior auth policy. Pre-graph retrieves the policy doc, planner sees it, responder answers without needing to call search_kb."
        : "Use case: agent that always needs KB context regardless of query type.",
    },
    planner: {
      title: "Planner",
      body: `Decides what to do next. Reads the user message + context and outputs a structured plan: which tool to call (or direct_answer if no tool needed).\n\nStrategy: ${strategy} — locked by overlay type, cannot be changed here.\n\n${
        strategy === "simple"
          ? "Simple strategy: one LLM call → one tool decision → executor runs it → responder answers. Linear, no loops."
          : strategy === "react"
          ? "ReAct strategy: Planner → Executor → (tool result fed back to Planner) × N steps → Responder. Loops until done or max_steps reached."
          : strategy === "plan_execute"
          ? "Plan-Execute: Planner generates a full multi-step plan upfront → Executor runs each step in sequence → Responder synthesizes."
          : `Strategy: ${strategy}.`
      }`,
      example: strategy === "simple"
        ? "User: 'What is the member's care plan?' → Planner: get_case_summary → Executor calls tool → Responder answers."
        : "User: 'Update the care plan and notify the team.' → Planner generates steps 1–3 → Executor runs each.",
    },
    executor: {
      title: "Executor",
      body: `Runs the tool call selected by the planner. Dispatches to the Tool Gateway, handles the response, and passes the result back.\n\n${
        plannerToolOn
          ? `Planner Tool RAG is ENABLED — if the planner calls search_kb, the executor routes that call through the KB retrieval pipeline (strategy: ${agentCfg?.retrieval?.planner_tool?.strategy || "semantic"} · pattern: ${agentCfg?.retrieval?.planner_tool?.pattern || "naive"}).`
          : "Planner Tool RAG is DISABLED — search_kb is not available as a planner tool. Enable in the RAG tab → Planner Tool section."
      }`,
      example: "Executor calls write_case_note → Tool Gateway → system of record API → result returned to graph.",
    },
    hitl_gate: {
      title: "HITL Gate",
      body: hitlOn
        ? "Currently ENABLED. Before any high-risk tool executes, the graph pauses and waits for human approval. The tool call is held in the approval queue until a supervisor approves or rejects it.\n\nConfigure which tools trigger approval in the HITL tab → Risk Levels."
        : "Currently DISABLED. All tool calls execute immediately with no approval gate.\n\nEnable in the HITL tab. Recommended for any agent that writes to a system of record.",
      example: hitlOn
        ? "write_case_note is high risk → graph pauses → supervisor sees the pending note → approves → tool executes."
        : "Enable HITL for care-management agents that write case notes or submit prior authorizations.",
    },
    responder: {
      title: "Responder",
      body: "Generates the final natural language response shown to the user. Runs after all tool calls are complete and approved.\n\nThe responder always runs — it is not configurable. What changes is what context it receives (tool results, KB chunks, memory).",
      example: "After get_case_summary executes, the responder formats the case data into a readable summary for the nurse.",
    },
    response: {
      title: "Response",
      body: "The final response delivered to the user. After this, post-graph memory writes fire.",
    },
    write_short_term: {
      title: "Short-Term Write (post-graph)",
      body: shortTermOn
        ? "ENABLED. The full conversation turn (user message + agent response) is written to short-term memory after every turn. Used to maintain conversation history across turns."
        : "DISABLED. Conversation history is not being stored. Enable in the Memory tab → Short-Term → Write.",
      example: "Next turn, the agent reads short-term memory to know what was discussed in previous turns.",
    },
    write_episodic: {
      title: "Episodic Write (post-graph)",
      body: episodicWriteOn
        ? "ENABLED. Significant events (tool calls, decisions, HITL outcomes) are written as episodic memory entries after each turn. These build a persistent event log for the member/case scope."
        : "DISABLED. Tool call events are not being persisted to episodic memory. Enable in the Memory tab → Episodic → Write.",
      example: "write_case_note was called → episodic entry: 'Case note written on 2026-04-09 by chat_agent.'",
    },
    write_semantic: {
      title: "Semantic Write (post-graph)",
      body: semanticWriteOn
        ? "ENABLED. After each turn, an LLM extracts durable facts from the exchange and stores them as semantic memories. These persist across sessions and are retrieved by future turns."
        : "DISABLED. No fact extraction happening. Enable in the Memory tab → Semantic → Write.",
      example: "Exchange mentions member is allergic to penicillin → semantic write: 'Member: penicillin allergy.'",
    },
    react_loop: {
      title: "ReAct Loop",
      body: `This agent uses the ReAct (Reason + Act) strategy. After each tool call, the result is fed back to the planner for the next reasoning step. This continues for up to max_steps iterations.\n\nEach iteration: Planner → Executor (tool call) → result injected back → Planner decides next step.\n\nFinal step: Planner outputs direct_answer → Responder generates response.`,
      example: "Step 1: get_member → Step 2: get_case_summary → Step 3: search_kb → Step 4: direct_answer.",
    },
  }
}

// ── Diagram layouts per agent type / strategy ─────────────────────────────────

// ── Phase band wrapper ────────────────────────────────────────────────────────

function ContainerBadge({ label, color }: { label: string; color: string }) {
  return (
    <Box sx={{
      display: "inline-flex", alignItems: "center", gap: 0.5,
      px: 1, py: 0.2, borderRadius: 1, border: `1px solid ${color}60`,
      bgcolor: `${color}10`, fontSize: 9, fontWeight: 700,
      color, letterSpacing: 0.5, textTransform: "uppercase",
    }}>{label}</Box>
  )
}

function Phaseband({
  label, color, bgcolor, container, children,
}: { label: string; color: string; bgcolor: string; container?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ border: `1.5px solid ${color}40`, borderRadius: 2, bgcolor, px: 2, pt: 1.5, pb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Typography fontSize={10} fontWeight={800} color={color}
          sx={{ textTransform: "uppercase", letterSpacing: 1 }}>
          {label}
        </Typography>
        {container && <ContainerBadge label={container} color={color} />}
      </Box>
      {children}
    </Box>
  )
}

function PhaseConnector() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 0.5 }}>
      <Box sx={{ fontSize: 20, color: "#cbd5e1", lineHeight: 1 }}>↓</Box>
    </Box>
  )
}

function DiagramSimple({
  config, agentType, onHover,
}: { config: AgentConfig; agentType: string; onHover: (key: string) => void }) {
  const agentCfg  = config.agent  || {}
  const memoryCfg = config.memory || {}

  const ragEnabled    = agentCfg?.retrieval?.enabled !== false
  const preGraphOn    = ragEnabled && agentCfg?.retrieval?.pre_graph?.enabled === true
  const plannerToolOn = ragEnabled && agentCfg?.retrieval?.planner_tool?.enabled !== false
  const hitlOn        = agentCfg?.features?.hitl === true
  const memoryOn      = agentCfg?.features?.memory === true
  const strategy      = agentCfg?.reasoning?.strategy || "simple"

  const preGraphStrategy = agentCfg?.retrieval?.pre_graph?.strategy || "hybrid"
  const preGraphPattern  = agentCfg?.retrieval?.pre_graph?.pattern  || "naive"

  const episodicWriteOn = memoryOn && memoryCfg?.write_policies?.episodic?.enabled === true
  const semanticWriteOn = memoryOn && memoryCfg?.write_policies?.semantic?.enabled === true
  const shortTermOn     = memoryOn && memoryCfg?.write_policies?.short_term?.enabled !== false

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── PRE-GRAPH ── */}
      <Phaseband label="Pre-Graph" color="#8b5cf6" bgcolor="#faf5ff" container="C1 → C2">
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
          <FlowNode nodeKey="user_message" onHover={onHover} label="User Message" color="#64748b" tag="input" sublabel="C1 auth + context" />
          <FlowArrow />
          <FlowNode nodeKey="pre_graph_rag" onHover={onHover} label="Pre-Graph RAG"
            sublabel={preGraphOn ? `C2 · ${preGraphStrategy} · ${preGraphPattern}` : "off"}
            active={preGraphOn} color="#8b5cf6" tag="rag"
          />
        </Box>
      </Phaseband>

      <PhaseConnector />

      {/* ── IN-GRAPH ── */}
      <Phaseband label="In-Graph" color="#6366f1" bgcolor="#f5f3ff" container="C2 platform-services">
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
          <FlowNode nodeKey="planner" onHover={onHover} label="Planner"
            sublabel={`C2 · ${strategy}`} active={true} color="#6366f1" tag="llm"
          />
          <FlowArrow label={plannerToolOn ? "search_kb?" : undefined} />
          <FlowNode nodeKey="executor" onHover={onHover} label="Executor"
            sublabel="C2 · tool dispatch" active={true} color="#0ea5e9" tag="tools"
          />
          <FlowArrow />
          <FlowNode nodeKey="hitl_gate" onHover={onHover} label="HITL Gate"
            sublabel={hitlOn ? "C1 · approval store" : "off"} active={hitlOn} color="#f59e0b" tag="approval"
          />
          <FlowArrow active={hitlOn} />
          <FlowNode nodeKey="responder" onHover={onHover} label="Responder"
            sublabel="C2 · final answer" active={true} color="#10b981" tag="llm"
          />
          <FlowArrow />
          <FlowNode nodeKey="response" onHover={onHover} label="Response" color="#64748b" tag="output" />
        </Box>
      </Phaseband>

      <PhaseConnector />

      {/* ── POST-GRAPH ── */}
      <Phaseband label="Post-Graph" color="#14b8a6" bgcolor="#f0fdfa" container="C1 → C2">
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <FlowBranch nodeKey="write_short_term" onHover={onHover} label="Short-Term Write" active={shortTermOn} />
          <FlowBranch nodeKey="write_episodic"   onHover={onHover} label="Episodic Write"   active={episodicWriteOn} />
          <FlowBranch nodeKey="write_semantic"   onHover={onHover} label="Semantic Write"   active={semanticWriteOn} />
        </Box>
      </Phaseband>

    </Box>
  )
}

function DiagramReact({
  config, agentType, onHover,
}: { config: AgentConfig; agentType: string; onHover: (key: string) => void }) {
  const agentCfg  = config.agent  || {}
  const memoryCfg = config.memory || {}

  const ragEnabled           = agentCfg?.retrieval?.enabled !== false
  const preGraphOn           = ragEnabled && agentCfg?.retrieval?.pre_graph?.enabled === true
  const hitlOn               = agentCfg?.features?.hitl === true
  const memoryOn             = agentCfg?.features?.memory === true
  const maxSteps             = agentCfg?.reasoning?.max_steps || "N"
  const writeIntermediateOn  = memoryOn && memoryCfg?.write_policies?.short_term?.write_intermediate_steps === true

  const preGraphStrategy = agentCfg?.retrieval?.pre_graph?.strategy || "hybrid"
  const preGraphPattern  = agentCfg?.retrieval?.pre_graph?.pattern  || "naive"

  const episodicWriteOn = memoryOn && memoryCfg?.write_policies?.episodic?.enabled === true
  const semanticWriteOn = memoryOn && memoryCfg?.write_policies?.semantic?.enabled === true
  const shortTermOn     = memoryOn && memoryCfg?.write_policies?.short_term?.enabled !== false

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── PRE-GRAPH ── */}
      <Phaseband label="Pre-Graph" color="#8b5cf6" bgcolor="#faf5ff" container="C1 → C2">
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
          <FlowNode nodeKey="user_message" onHover={onHover} label="User Message" color="#64748b" tag="input" sublabel="C1 auth + context" />
          <FlowArrow />
          <FlowNode nodeKey="pre_graph_rag" onHover={onHover} label="Pre-Graph RAG"
            sublabel={preGraphOn ? `C2 · ${preGraphStrategy} · ${preGraphPattern}` : "off"}
            active={preGraphOn} color="#8b5cf6" tag="rag"
          />
        </Box>
      </Phaseband>

      <PhaseConnector />

      {/* ── IN-GRAPH (loop) ── */}
      <Phaseband label="In-Graph — ReAct Loop" color="#6366f1" bgcolor="#f5f3ff" container="C2 platform-services">
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", mb: writeIntermediateOn ? 1.5 : 0 }}>
          <FlowNode nodeKey="planner" onHover={onHover} label="Planner"
            sublabel={`C2 · think · max ${maxSteps} steps`} active={true} color="#6366f1" tag="llm"
          />
          <FlowArrow />
          <FlowNode nodeKey="executor" onHover={onHover} label="Executor"
            sublabel="C2 · tool dispatch" active={true} color="#0ea5e9" tag="tools"
          />
          <FlowLoopArrow />
          <FlowNode nodeKey="hitl_gate" onHover={onHover} label="HITL Gate"
            sublabel={hitlOn ? "C1 · approval store" : "off"} active={hitlOn} color="#f59e0b" tag="approval"
          />
          <FlowArrow />
          <FlowNode nodeKey="responder" onHover={onHover} label="Responder"
            sublabel="C2 · loop ends → respond" active={true} color="#10b981" tag="llm"
          />
          <FlowArrow />
          <FlowNode nodeKey="response" onHover={onHover} label="Response" color="#64748b" tag="output" />
        </Box>
        {writeIntermediateOn && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography fontSize={11} color="#6366f1" sx={{ minWidth: 130 }}>↺ after each step:</Typography>
            <FlowBranch nodeKey="write_short_term" onHover={onHover} label="Short-Term Write" active={true} />
          </Box>
        )}
      </Phaseband>

      <PhaseConnector />

      {/* ── POST-GRAPH ── */}
      <Phaseband label="Post-Graph" color="#14b8a6" bgcolor="#f0fdfa">
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <FlowBranch nodeKey="write_short_term" onHover={onHover} label="Short-Term Write" active={shortTermOn} />
          <FlowBranch nodeKey="write_episodic"   onHover={onHover} label="Episodic Write"   active={episodicWriteOn} />
          <FlowBranch nodeKey="write_semantic"   onHover={onHover} label="Semantic Write"   active={semanticWriteOn} />
        </Box>
      </Phaseband>

    </Box>
  )
}

function DiagramSummary({
  config, onHover,
}: { config: AgentConfig; onHover: (key: string) => void }) {
  const agentCfg  = config.agent  || {}
  const memoryCfg = config.memory || {}
  const memoryOn  = agentCfg?.features?.memory === true
  const shortTermOn = memoryOn && memoryCfg?.write_policies?.short_term?.enabled !== false

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>

      <Phaseband label="Pre-Graph" color="#8b5cf6" bgcolor="#faf5ff" container="C1 → C2">
        <FlowNode nodeKey="user_message" onHover={onHover} label="Input Context"
          sublabel="C1 · scope data injected" color="#64748b" tag="input" />
      </Phaseband>

      <PhaseConnector />

      <Phaseband label="In-Graph" color="#6366f1" bgcolor="#f5f3ff" container="C2 platform-services">
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <FlowNode nodeKey="planner" onHover={onHover} label="Summarizer"
            sublabel="C2 · single LLM pass" active={true} color="#6366f1" tag="llm"
          />
          <FlowArrow />
          <FlowNode nodeKey="response" onHover={onHover} label="Summary" color="#10b981" tag="output" />
        </Box>
        <Typography fontSize={11} color="text.disabled" sx={{ mt: 1 }}>
          No tool executor · No HITL gate · No planner tool RAG
        </Typography>
      </Phaseband>

      <PhaseConnector />

      <Phaseband label="Post-Graph" color="#14b8a6" bgcolor="#f0fdfa" container="C1 → C2">
        <FlowBranch nodeKey="write_short_term" onHover={onHover} label="Short-Term Write" active={shortTermOn} />
      </Phaseband>

    </Box>
  )
}

function LiveFlowDiagram({ config, agentType, onHover }: { config: AgentConfig; agentType: string; onHover: (key: string) => void }) {
  const strategy = config.agent?.reasoning?.strategy || "simple"

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
          Live Agent Flow
        </Typography>
        <Typography fontSize={11} color="text.disabled">— reflects current config · hover any node for details</Typography>
      </Box>

      {agentType === "summarization_agent_simple"
        ? <DiagramSummary config={config} onHover={onHover} />
        : strategy === "react"
        ? <DiagramReact config={config} agentType={agentType} onHover={onHover} />
        : <DiagramSimple config={config} agentType={agentType} onHover={onHover} />
      }

      {/* Legend */}
      <Box sx={{ display: "flex", gap: 2, mt: 2, flexWrap: "wrap", alignItems: "center" }}>
        <Typography fontSize={10} fontWeight={600} color="text.disabled" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>Legend:</Typography>
        {[
          { color: "#6366f1", tag: "LLM",      label: "LLM call" },
          { color: "#0ea5e9", tag: "TOOLS",    label: "Tool execution" },
          { color: "#8b5cf6", tag: "RAG",      label: "Retrieval" },
          { color: "#f59e0b", tag: "APPROVAL", label: "Approval gate" },
        ].map(({ color, tag, label }) => (
          <Box key={tag} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ px: 0.7, py: 0.1, borderRadius: 0.5, bgcolor: color }}>
              <Typography fontSize={9} fontWeight={700} color="white" sx={{ letterSpacing: 0.3 }}>{tag}</Typography>
            </Box>
            <Typography fontSize={11} color="text.secondary">{label}</Typography>
          </Box>
        ))}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 24, height: 14, borderRadius: 1, border: "1.5px dashed #14b8a6", bgcolor: "#f0fdfa" }} />
          <Typography fontSize={11} color="text.secondary">Memory write</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 24, height: 14, borderRadius: 1, border: "2px solid #e2e8f0", bgcolor: "#f9fafb" }} />
          <Typography fontSize={11} color="text.secondary">Disabled</Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ── Help hint indicator ───────────────────────────────────────────────────────

function HelpHint({ active }: { active: boolean }) {
  return (
    <Box component="span" sx={{
      width: 15, height: 15, borderRadius: "50%", flexShrink: 0,
      bgcolor: active ? "#6366f1" : "#e2e8f0",
      color: active ? "white" : "#94a3b8",
      fontSize: 9, fontWeight: 800, fontStyle: "italic",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.15s", cursor: "default", ml: 0.5,
    }}>i</Box>
  )
}

// ── Overview help content ─────────────────────────────────────────────────────

const OVERVIEW_HELP: Record<string, { title: string; body: string; example?: string }> = {
  reasoning_strategy: {
    title: "Reasoning Strategy",
    body: "Controls the shape of the LangGraph graph — how the agent plans and acts.\n\nLocked at scaffold time by the overlay type selected. Cannot be changed here without re-scaffolding with a different overlay.\n\nsimple — linear: Planner → Executor → Responder. One tool call per turn. Lowest cost.\n\nreact — loop: Planner → Executor → (result back to Planner) × N steps → Responder. Best for multi-step tasks.\n\nplan_execute — two phases: Planner generates full plan upfront → Executor runs each step in sequence.",
    example: "simple: nurse asks 'show me the assessment' → one tool call → done. react: nurse asks 'update the care plan and write a note' → 2–3 tool calls chained.",
  },
  features: {
    title: "Features",
    body: "High-level on/off switches for platform capabilities. Each feature gates an entire subsystem:\n\nmemory — read/write memory context each turn. Configure in Memory tab.\nrag — enable knowledge base retrieval. Configure in RAG tab.\nhitl — enable human approval gate before tool execution. Configure in HITL tab.\nobservability — emit execution traces. Shown in the trace panel.\nprompt_versioning — use versioned prompts from Prompt Governance instead of local defaults.",
    example: "hitl: false → all tool calls execute immediately, no approval. hitl: true → high-risk tools pause for supervisor sign-off.",
  },
  yaml_agent: {
    title: "agent.yaml",
    body: "The primary agent config file. Controls everything about how the agent thinks and acts:\n\n• reasoning.strategy — which graph shape to use\n• tools.allowed — which tools the agent can call\n• retrieval — RAG settings (pre-graph, planner tool, strategies)\n• risk.risk_levels — per-tool HITL risk classification\n• hitl — approval routing rules and SLA\n• features — on/off flags for memory, RAG, HITL, observability\n• hard_routes — deterministic phrase → tool mappings\n\nOwned by the agent overlay. Modified via Agent Registry tabs. Written by the support API on save.",
    example: "Enabling HITL in the HITL tab writes features.hitl: true into this file.",
  },
  yaml_memory: {
    title: "memory.yaml",
    body: "Defines read and write policies for each memory type: short_term, episodic, semantic, summary.\n\nSeparate from agent.yaml because memory policies are large, change independently, and need their own lifecycle (e.g. tuning episodic write triggers without touching RAG or tool config).\n\nEach memory type has independent read_policies and write_policies. Read and write are fully decoupled — you can read from a memory type without writing to it.",
    example: "Disable episodic write but keep episodic read → agent uses past event history but doesn't add new events this session.",
  },
  yaml_prompts: {
    title: "prompts.yaml (prompt-defaults.yaml)",
    body: "Default system prompt and planner prompt for this agent overlay. These are the fallback prompts used when Prompt Governance has no active versioned prompt for this agent.\n\nThe planner prompt must match the reasoning strategy format:\n• simple — expects {tool}: {argument} output\n• react — expects thought + tool + argument each step\n• plan_execute — expects a numbered plan\n\nIf prompt_versioning is enabled, the live prompt is fetched from the Prompt Governance service — this file is only used as fallback.",
    example: "You change the system prompt here to add clinical guidelines. If prompt_versioning is off, this takes effect immediately on next restart.",
  },
  yaml_domain: {
    title: "domain.yaml",
    body: "Defines the capability's context scopes — what entities exist, their ID fields, and their hierarchy.\n\nThis file lives at the capability level and is copied into the agent at scaffold time. It is READ-ONLY from the agent's perspective — changes should be made at the capability level and re-scaffolded.\n\nThe platform uses domain.yaml to:\n• Resolve scope IDs from session context\n• Validate hard route scope ↔ tool pairings\n• Determine which scopes receive memory writes\n• Build context injection for the LLM",
    example: "member → member_id. case (parent: member) → case_id. assessment (parent: case) → assessment_id. Hierarchy: member > case > assessment.",
  },
  yaml_manifest: {
    title: "agent_manifest.yaml",
    body: "Declares what this overlay is and what it requires.\n\nIncludes:\n• agent_type — technical type (chat_agent, summary_agent, react_agent)\n• display_name — business-friendly name shown in the UI (e.g. 'Research Buddy')\n• components — which pipeline stages this overlay implements\n• features — capability flags (memory, rag, hitl, observability)\n• entrypoint — which graph file to run\n• rag_dimension2 — which RAG pattern is coded in this overlay\n\nThis file is READ-ONLY at runtime — it describes what the overlay is, not how to configure it. To rename the agent, update display_name here.",
    example: "Set display_name: 'Research Buddy' to change how this agent appears in the UI without changing the agent_type.",
  },
}

const CONFIG_FILES = [
  { key: "agent",    label: "agent.yaml",          helpKey: "yaml_agent",    description: "Agent behavior — reasoning strategy, tools, RAG, HITL, features" },
  { key: "memory",   label: "memory.yaml",          helpKey: "yaml_memory",   description: "Memory read/write policies per scope type" },
  { key: "prompts",  label: "prompts.yaml",         helpKey: "yaml_prompts",  description: "System prompt and planner prompt overrides" },
  { key: "domain",   label: "domain.yaml",          helpKey: "yaml_domain",   description: "Capability scope definitions — member, case, assessment IDs and hierarchy (read-only)" },
  { key: "manifest", label: "agent_manifest.yaml",  helpKey: "yaml_manifest", description: "Overlay identity — agent type, display name, components, features, entrypoint (read-only)" },
]

function YamlViewer({ config, helpKey, onHover }: { config: AgentConfig; helpKey: string; onHover: (key: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const toggle = (key: string) => setOpen(prev => ({ ...prev, [key]: !prev[key] }))

  const toYaml = (obj: any, indent = 0): string => {
    if (obj === null || obj === undefined) return "null"
    if (typeof obj === "boolean") return obj ? "true" : "false"
    if (typeof obj === "number") return String(obj)
    if (typeof obj === "string") return obj.includes("\n") ? `|\n${" ".repeat(indent + 2)}${obj.replace(/\n/g, `\n${" ".repeat(indent + 2)}`)}` : obj
    if (Array.isArray(obj)) {
      if (obj.length === 0) return "[]"
      return obj.map(v => `${" ".repeat(indent)}- ${toYaml(v, indent + 2)}`).join("\n")
    }
    if (typeof obj === "object") {
      const entries = Object.entries(obj)
      if (entries.length === 0) return "{}"
      return entries.map(([k, v]) => {
        const valStr = toYaml(v, indent + 2)
        const isBlock = typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0
        const isArr   = Array.isArray(v) && v.length > 0
        return isBlock || isArr
          ? `${" ".repeat(indent)}${k}:\n${valStr}`
          : `${" ".repeat(indent)}${k}: ${valStr}`
      }).join("\n")
    }
    return String(obj)
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {CONFIG_FILES.map(({ key, label, helpKey: hk, description }) => {
        const data   = (config as any)[key]
        const isOpen = !!open[key]
        const active = helpKey === hk
        return (
          <Box key={key} onMouseEnter={() => onHover(hk)}
            sx={{ border: `1.5px solid ${active ? "#6366f1" : "#e2e8f0"}`, borderRadius: 1.5, overflow: "hidden", transition: "border-color 0.15s" }}>
            <ListItemButton onClick={() => toggle(key)} sx={{ px: 2, py: 1.2 }}>
              <Box sx={{ flex: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
                <Typography fontSize={12} fontWeight={700} component="span">{label}</Typography>
                <HelpHint active={active} />
                <Typography fontSize={11} color="text.secondary" sx={{ ml: 0.5 }} component="span">{description}</Typography>
              </Box>
              {isOpen ? <ExpandLessIcon fontSize="small" sx={{ color: "text.secondary" }} /> : <ExpandMoreIcon fontSize="small" sx={{ color: "text.secondary" }} />}
            </ListItemButton>
            <Collapse in={isOpen}>
              <Box sx={{ bgcolor: "#1e1e2e", px: 2, py: 1.5, overflowX: "auto" }}>
                <Typography component="pre" sx={{ fontSize: 11, fontFamily: "monospace", color: "#cdd6f4", lineHeight: 1.6, m: 0, whiteSpace: "pre" }}>
                  {data ? toYaml(data) : "# no config loaded"}
                </Typography>
              </Box>
            </Collapse>
          </Box>
        )
      })}
    </Box>
  )
}

// ── SavedBadge ────────────────────────────────────────────────────────────────
// Inline indicator next to each field showing the saved (current) value.
// Goes amber with strikethrough when local value differs from saved.

function SavedBadge({ saved, current }: { saved: string; current: string }) {
  const changed = saved !== current
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, ml: 1, flexShrink: 0 }}>
      {changed ? (
        <>
          <Chip label={saved || "—"} size="small" sx={{ height: 18, fontSize: 10, bgcolor: "#fee2e2", color: "#991b1b", textDecoration: "line-through", fontWeight: 600 }} />
          <Typography fontSize={11} color="#94a3b8" fontWeight={700}>→</Typography>
          <Chip label={current || "—"} size="small" sx={{ height: 18, fontSize: 10, bgcolor: "#fefce8", color: "#854d0e", fontWeight: 700, border: "1.5px solid #fde68a" }} />
        </>
      ) : (
        <Chip label={saved || "—"} size="small" sx={{ height: 18, fontSize: 10, bgcolor: "#fefce8", color: "#854d0e", fontWeight: 600, border: "1px solid #fde68a" }} />
      )}
    </Box>
  )
}

function OverviewTab({ agent, manifest, config }: { agent: AgentRecord; manifest: any; config: AgentConfig }) {
  const agentCfg  = config.agent || {}
  const strategy  = agentCfg?.reasoning?.strategy || "simple"
  const features  = agentCfg?.features || agent.features || {}
  const [helpKey, setHelpKey] = useState<string>("reasoning_strategy")

  // Merge static overview help + dynamic flow help
  const flowHelp    = buildFlowHelp(config, agent.agent_type)
  const allHelp     = { ...OVERVIEW_HELP, ...flowHelp }
  const helpContent = allHelp[helpKey]

  return (
    <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>

      {/* ── Left: all content ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0 }}>

        {/* Identity row */}
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1.5 }}>
          {[
            ["Capability",          agent.capability_name],
            ["Agent",               agent.agent_repo_name],
            ["Overlay Type",        agent.agent_type],
            ["C1 — Agent Runtime",  agent.runtime_url],
          ].map(([label, val]) => (
            <Box key={label} sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <Typography fontSize={10} fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5 }}>{label}</Typography>
              <Typography fontSize={13} fontWeight={600}>{val || "—"}</Typography>
            </Box>
          ))}
        </Box>

        {/* Container URLs + Mini UI link */}
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1.5 }}>
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <Typography fontSize={10} fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5 }}>C2 — Platform Services</Typography>
            <Typography fontSize={12} fontWeight={600} color="text.secondary">
              {agent.runtime_url ? agent.runtime_url.replace(":8001", ":8002").replace(":8081", ":8002") : "http://localhost:8002"}
            </Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <Typography fontSize={10} fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5 }}>Tool Gateway</Typography>
            <Typography fontSize={12} fontWeight={600} color="text.secondary">http://localhost:8080</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "#f0f4ff", border: "1.5px solid #6366f1" }}>
            <Typography fontSize={10} fontWeight={600} color="#6366f1" sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5 }}>Agent UI</Typography>
            <Box
              component="a"
              href={`http://localhost:8000/agent-ui/${agent.capability_name}/${agent.agent_repo_name}/${agent.agent_type}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ fontSize: 12, fontWeight: 700, color: "#6366f1", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
            >
              Open Chat UI ↗
            </Box>
          </Box>
        </Box>

        {/* Reasoning strategy + features */}
        <Box sx={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 1.5 }}>
          <Box onMouseEnter={() => setHelpKey("reasoning_strategy")}
            sx={{ p: 1.5, borderRadius: 1.5, border: `1.5px solid ${helpKey === "reasoning_strategy" ? "#6366f1" : "#e2e8f0"}`, cursor: "default", transition: "border-color 0.15s" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
              <Typography fontSize={10} fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>Reasoning Strategy</Typography>
              <HelpHint active={helpKey === "reasoning_strategy"} />
              <Tooltip title="Locked at scaffold time."><LockIcon sx={{ fontSize: 11, color: "#94a3b8" }} /></Tooltip>
            </Box>
            <Typography fontSize={15} fontWeight={700} color="#6366f1">{strategy}</Typography>
            <Typography fontSize={11} color="text.disabled">locked by overlay</Typography>
          </Box>

          <Box onMouseEnter={() => setHelpKey("features")}
            sx={{ p: 1.5, borderRadius: 1.5, border: `1.5px solid ${helpKey === "features" ? "#6366f1" : "#e2e8f0"}`, cursor: "default", transition: "border-color 0.15s" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
              <Typography fontSize={10} fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>Features</Typography>
              <HelpHint active={helpKey === "features"} />
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {Object.entries(features).map(([k, v]) => (
                <Chip key={k} label={k} size="small" color={v ? "primary" : "default"} variant={v ? "filled" : "outlined"} sx={{ fontSize: 11 }} />
              ))}
            </Box>
          </Box>
        </Box>

        <Divider />

        {/* Live flow diagram — passes shared setHelpKey */}
        <LiveFlowDiagram config={config} agentType={agent.agent_type} onHover={setHelpKey} />

        <Divider />

        {/* Config files */}
        <Box>
          <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ mb: 1.5, textTransform: "uppercase", letterSpacing: 0.5 }}>Config Files</Typography>
          <YamlViewer config={config} helpKey={helpKey} onHover={setHelpKey} />
        </Box>
      </Box>

      {/* ── Right: single sticky help panel for entire tab ── */}
      <Box sx={{ width: 255, flexShrink: 0, position: "sticky", top: 0 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "#fafafa" }}>
          <Typography fontSize={12} fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
            {helpContent?.title || "Hover any element"}
          </Typography>
          {helpContent ? (
            <>
              <Typography fontSize={12} color="text.secondary" sx={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>
                {helpContent.body}
              </Typography>
              {helpContent.example && (
                <Box sx={{ mt: 1.5, p: 1.5, bgcolor: "#f0f4ff", borderRadius: 1, borderLeft: "3px solid #6366f1" }}>
                  <Typography fontSize={11} color="#4338ca" sx={{ lineHeight: 1.5 }}>
                    <strong>Example:</strong> {helpContent.example}
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Typography fontSize={12} color="text.disabled">
              Hover any card, node, or config file to see what it does.
            </Typography>
          )}
        </Paper>
      </Box>

    </Box>
  )
}

function ToolsTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const agentCfg = config.agent || {}
  const [mode, setMode] = useState<string>("selected")
  const [allowedTools, setAllowedTools] = useState<string[]>([])
  const [newTool, setNewTool] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMode(agentCfg?.tools?.mode || "selected")
    setAllowedTools(agentCfg?.tools?.allowed || [])
  }, [config])

  const save = async () => {
    setSaving(true)
    await onSave("agent", { tools: { mode, allowed: allowedTools } })
    setSaving(false)
  }

  const savedMode = agentCfg?.tools?.mode || "selected"
  const savedAllowed = agentCfg?.tools?.allowed || []

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <FormControl size="small" sx={{ maxWidth: 240 }}>
          <InputLabel>Tool Access Mode</InputLabel>
          <Select value={mode} label="Tool Access Mode" onChange={e => setMode(e.target.value)}>
            <MenuItem value="selected">Selected (allowlist)</MenuItem>
            <MenuItem value="auto">Auto (by tag)</MenuItem>
          </Select>
        </FormControl>
        <SavedBadge saved={savedMode} current={mode} />
      </Box>

      {mode === "selected" && (
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Allowed Tools</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tool Name</TableCell>
                <TableCell>Saved</TableCell>
                <TableCell align="right">Remove</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {allowedTools.length === 0 && savedAllowed.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} sx={{ color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>No tools configured</TableCell>
                </TableRow>
              )}
              {allowedTools.map((t) => {
                const isSaved = savedAllowed.includes(t)
                return (
                  <TableRow key={t}>
                    <TableCell sx={{ fontWeight: 500 }}>{t}</TableCell>
                    <TableCell>
                      {isSaved
                        ? <Chip label="saved" size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#fefce8", color: "#854d0e", border: "1px solid #fde68a", fontWeight: 700 }} />
                        : <Chip label="new" size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa", fontWeight: 700 }} />
                      }
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => setAllowedTools(allowedTools.filter(x => x !== t))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
              {savedAllowed.filter((t: string) => !allowedTools.includes(t)).map((t: string) => (
                <TableRow key={`removed-${t}`} sx={{ opacity: 0.5 }}>
                  <TableCell><s>{t}</s></TableCell>
                  <TableCell><Chip label="removed" size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#fee2e2", color: "#991b1b", fontWeight: 700 }} /></TableCell>
                  <TableCell />
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <TextField
                    size="small"
                    placeholder="tool_name"
                    value={newTool}
                    onChange={e => setNewTool(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && newTool.trim()) {
                        setAllowedTools([...allowedTools, newTool.trim()])
                        setNewTool("")
                      }
                    }}
                    sx={{ width: 200 }}
                  />
                </TableCell>
                <TableCell />
                <TableCell align="right">
                  <Button size="small" startIcon={<AddIcon />} onClick={() => {
                    if (newTool.trim()) { setAllowedTools([...allowedTools, newTool.trim()]); setNewTool("") }
                  }}>Add</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      )}

      <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save Tools"}
      </Button>
    </Box>
  )
}

const HITL_HELP: Record<string, { title: string; body: string; example?: string }> = {
  hitl_enabled:        { title: "HITL Enabled", body: "Master switch for human-in-the-loop approval. When off, all tool calls execute immediately with no approval gate. When on, each tool call is evaluated against the trigger rules below before execution.", example: "Turn off for a read-only FAQ agent. Turn on for any agent that writes to a system of record." },
  trigger_action:      { title: "Trigger: Action Risk", body: "The most common trigger. Fires when the agent is about to execute a tool call that writes or changes something — a case note, a record update, a workflow submission.\n\nRisk level per tool is configured in the Risk Levels table below. The Routing Rules table maps risk levels to approval required yes/no.", example: "write_case_note = high → requires approval. get_member = low → no approval needed." },
  trigger_confidence:  { title: "Trigger: Confidence / Uncertainty (Roadmap)", body: "Fires when the agent's response or plan falls below a confidence threshold — before responding to the user.\n\nCommon in: clinical decision support (low-confidence diagnosis suggestion), fraud detection (borderline model score).\n\nNot yet built — roadmap item. Requires LLM self-scoring or classifier output.", example: "Agent suggests a care plan adjustment with 0.55 confidence → routed to nurse for review before sending." },
  trigger_regulatory:  { title: "Trigger: Regulatory Gate (Roadmap)", body: "Certain actions must have human sign-off by regulation — regardless of risk score or confidence. Not optional, not configurable away.\n\nExamples: prior authorization submission (payer rules), claim denial (licensed adjuster required), large financial transactions.\n\nNot yet built — roadmap item. Requires a rules engine layer separate from the risk scoring path.", example: "submit_prior_auth tool → always requires approval, regardless of risk_levels config." },
  risk_levels:         { title: "Risk Levels per Tool", body: "Static risk classification for each tool. Determines which routing rule applies when that tool is called.\n\nhigh — agent is about to write or take a consequential action.\nmedium — agent is taking a mildly sensitive action.\nlow — read-only or non-consequential.\n\nNote: dynamic risk scoring (per-invocation, context-aware) is a roadmap item.", example: "write_case_note: high. get_member: low. search_kb: low." },
  routing_rules:       { title: "Routing Rules", body: "Maps each risk level to whether human approval is required. When a tool is called, its risk level is looked up here to decide if the graph pauses and waits for approval.\n\nToday: approval routing is risk-level only. Role-based routing (route high-risk to senior nurse vs junior) is a roadmap item.", example: "high → requires_approval: true. low → requires_approval: false." },
  timeout:             { title: "SLA Timeout", body: "How long the agent waits for a human approval response before the request expires. After timeout, the tool call is blocked (not auto-approved).\n\nSet based on your workflow SLA. Clinical workflows: 30–60 min. Financial approval: 15–30 min.", example: "timeout_minutes: 60 → approval request expires after 1 hour if no response." },
}

function HitlTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const agentCfg = config.agent || {}
  const [hitlEnabled, setHitlEnabled]       = useState(false)
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [riskLevels, setRiskLevels]         = useState<Record<string, string>>({})
  const [routingRules, setRoutingRules]     = useState<Array<{ risk_level: string; requires_approval: boolean }>>([])
  const [timeoutMinutes, setTimeoutMinutes] = useState(60)
  const [saving, setSaving]                 = useState(false)
  const [helpKey, setHelpKey]               = useState<string>("hitl_enabled")

  useEffect(() => {
    setHitlEnabled(agentCfg?.features?.hitl || false)
    setApprovalRequired(agentCfg?.risk?.approval_required || false)
    setRiskLevels(agentCfg?.risk?.risk_levels || {})
    setRoutingRules(agentCfg?.hitl?.routing_rules || [])
    setTimeoutMinutes(agentCfg?.hitl?.sla?.timeout_minutes || 60)
  }, [config])

  const help = (key: string) => ({ onMouseEnter: () => setHelpKey(key), onFocus: () => setHelpKey(key) })

  const save = async () => {
    setSaving(true)
    await onSave("agent", {
      features: { ...agentCfg?.features, hitl: hitlEnabled },
      risk: { approval_required: approvalRequired, risk_levels: riskLevels },
      hitl: { routing_rules: routingRules, sla: { timeout_minutes: timeoutMinutes } },
    })
    setSaving(false)
  }

  const helpContent = HITL_HELP[helpKey]

  const savedHitlEnabled = String(!!agentCfg?.features?.hitl)
  const savedApprovalRequired = String(!!agentCfg?.risk?.approval_required)
  const savedTimeout = String(agentCfg?.hitl?.sla?.timeout_minutes || 60)

  return (
    <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
      {/* ── Left: config ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>

        {/* Master switch */}
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <FormControlLabel
            {...help("hitl_enabled")}
            control={<Switch checked={hitlEnabled} onChange={e => setHitlEnabled(e.target.checked)} />}
            label={<Typography fontWeight={700}>HITL Enabled</Typography>}
          />
          <SavedBadge saved={savedHitlEnabled} current={String(hitlEnabled)} />
        </Box>

        {/* ── Triggers ── */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <Typography fontWeight={700} fontSize={14}>Approval Triggers</Typography>
            <Typography variant="caption" color="text.secondary">What causes the agent to pause and request human approval</Typography>
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>

            {/* Action risk */}
            <Box {...help("trigger_action")} sx={{ px: 2, py: 1.5, borderBottom: "1px solid #e2e8f0", cursor: "default" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                  <Typography fontSize={13} fontWeight={600}>Action Risk</Typography>
                  <Typography fontSize={12} color="text.secondary">Agent is about to write or execute a tool call on a system of record</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip label="Built" size="small" color="success" variant="outlined" sx={{ fontSize: 11 }} />
                  <Switch
                    size="small"
                    checked={approvalRequired}
                    onChange={e => setApprovalRequired(e.target.checked)}
                    disabled={!hitlEnabled}
                  />
                  <SavedBadge saved={savedApprovalRequired} current={String(approvalRequired)} />
                </Box>
              </Box>
            </Box>

            {/* Confidence */}
            <Box {...help("trigger_confidence")} sx={{ px: 2, py: 1.5, borderBottom: "1px solid #e2e8f0", cursor: "default" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                  <Typography fontSize={13} fontWeight={600} color="text.disabled">Confidence / Uncertainty</Typography>
                  <Typography fontSize={12} color="text.disabled">Agent response or plan falls below a confidence threshold</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip label="Roadmap" size="small" variant="outlined" sx={{ fontSize: 11, color: "#94a3b8", borderColor: "#cbd5e1" }} />
                  <Tooltip title="Not yet built — roadmap item">
                    <span>
                      <Switch size="small" disabled checked={false} />
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Box>

            {/* Regulatory gate */}
            <Box {...help("trigger_regulatory")} sx={{ px: 2, py: 1.5, cursor: "default" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                  <Typography fontSize={13} fontWeight={600} color="text.disabled">Regulatory Gate</Typography>
                  <Typography fontSize={12} color="text.disabled">Tool call requires approval by regulation regardless of risk score</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip label="Roadmap" size="small" variant="outlined" sx={{ fontSize: 11, color: "#94a3b8", borderColor: "#cbd5e1" }} />
                  <Tooltip title="Not yet built — roadmap item">
                    <span>
                      <Switch size="small" disabled checked={false} />
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Box>

          </Box>
        </Paper>

        {/* ── Risk Levels ── */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }} {...help("risk_levels")}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <Typography fontWeight={700} fontSize={14}>Risk Levels per Tool</Typography>
            <Typography variant="caption" color="text.secondary">Static classification — which risk level applies when each tool is called</Typography>
          </Box>
          <Box sx={{ p: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tool</TableCell>
                  <TableCell>Saved</TableCell>
                  <TableCell>Risk Level</TableCell>
                  <TableCell align="right">Remove</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(riskLevels).map(([tool, level]) => {
                  const savedLevel = (agentCfg?.risk?.risk_levels || {})[tool]
                  const isNew = !savedLevel
                  const changed = savedLevel && savedLevel !== level
                  return (
                    <TableRow key={tool}>
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          {tool}
                          {isNew && <Chip label="new" size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#dcfce7", color: "#166534", fontWeight: 700 }} />}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {isNew
                          ? <Typography fontSize={11} color="text.disabled">—</Typography>
                          : <Chip label={savedLevel} size="small" sx={{ height: 16, fontSize: 10, bgcolor: changed ? "#fee2e2" : "#f1f5f9", color: changed ? "#991b1b" : "#64748b", textDecoration: changed ? "line-through" : "none" }} />
                        }
                      </TableCell>
                      <TableCell>
                        <Select size="small" value={level} onChange={e => setRiskLevels({ ...riskLevels, [tool]: e.target.value })} disabled={!hitlEnabled}>
                          {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                        </Select>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" disabled={!hitlEnabled} onClick={() => {
                          const next = { ...riskLevels }; delete next[tool]; setRiskLevels(next)
                        }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {/* Removed rows — saved tools no longer in local state */}
                {Object.keys(agentCfg?.risk?.risk_levels || {}).filter(t => !(t in riskLevels)).map(tool => (
                  <TableRow key={`removed-${tool}`} sx={{ opacity: 0.45 }}>
                    <TableCell><Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><s>{tool}</s><Chip label="removed" size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#fee2e2", color: "#991b1b" }} /></Box></TableCell>
                    <TableCell><Chip label={(agentCfg?.risk?.risk_levels || {})[tool]} size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#f1f5f9", color: "#64748b" }} /></TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4}>
                    <Button size="small" startIcon={<AddIcon />} disabled={!hitlEnabled}
                      onClick={() => setRiskLevels({ ...riskLevels, new_tool: "low" })}>
                      Add Tool
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
        </Paper>

        {/* ── Routing Rules ── */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }} {...help("routing_rules")}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <Typography fontWeight={700} fontSize={14}>Routing Rules</Typography>
            <Typography variant="caption" color="text.secondary">Maps risk level → approval required. Role-based routing is roadmap.</Typography>
          </Box>
          <Box sx={{ p: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Risk Level</TableCell>
                  <TableCell>Requires Approval</TableCell>
                  <TableCell align="right">Remove</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {routingRules.map((rule, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select size="small" value={rule.risk_level} disabled={!hitlEnabled} onChange={e => {
                        const next = [...routingRules]; next[i] = { ...next[i], risk_level: e.target.value }; setRoutingRules(next)
                      }}>
                        {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch size="small" checked={rule.requires_approval} disabled={!hitlEnabled} onChange={e => {
                        const next = [...routingRules]; next[i] = { ...next[i], requires_approval: e.target.checked }; setRoutingRules(next)
                      }} />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" disabled={!hitlEnabled} onClick={() => setRoutingRules(routingRules.filter((_, j) => j !== i))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3}>
                    <Button size="small" startIcon={<AddIcon />} disabled={!hitlEnabled}
                      onClick={() => setRoutingRules([...routingRules, { risk_level: "high", requires_approval: true }])}>
                      Add Rule
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
        </Paper>

        {/* ── SLA ── */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <TextField
            {...help("timeout")}
            label="SLA Timeout (minutes)"
            type="number"
            size="small"
            value={timeoutMinutes}
            disabled={!hitlEnabled}
            onChange={e => setTimeoutMinutes(Number(e.target.value))}
            sx={{ maxWidth: 200 }}
          />
          <SavedBadge saved={savedTimeout} current={String(timeoutMinutes)} />
        </Box>

        <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
          {saving ? "Saving…" : "Save HITL"}
        </Button>
      </Box>

      {/* ── Right: contextual help panel ── */}
      <Box sx={{ width: 260, flexShrink: 0, position: "sticky", top: 0 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "#fafafa" }}>
          <Typography fontSize={12} fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
            {helpContent?.title || "Hover any field for help"}
          </Typography>
          {helpContent && (
            <>
              <Typography fontSize={12} color="text.secondary" sx={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>
                {helpContent.body}
              </Typography>
              {helpContent.example && (
                <Box sx={{ mt: 1.5, p: 1.5, bgcolor: "#f0f4ff", borderRadius: 1, borderLeft: "3px solid #6366f1" }}>
                  <Typography fontSize={11} color="#4338ca" sx={{ lineHeight: 1.5 }}>
                    <strong>Example:</strong> {helpContent.example}
                  </Typography>
                </Box>
              )}
            </>
          )}
          <Divider sx={{ my: 1.5 }} />
          <Typography fontSize={11} color="text.disabled">
            Adapter: <strong>internal</strong> <Chip label="others roadmap" size="small" sx={{ fontSize: 10, height: 16 }} />
          </Typography>
        </Paper>
      </Box>
    </Box>
  )
}

const MEMORY_TYPES = [
  { key: "short_term", label: "Short-Term",  description: "Conversation history — written every turn" },
  { key: "episodic",   label: "Episodic",    description: "Event log — tool calls, assessments, decisions" },
  { key: "semantic",   label: "Semantic",    description: "Persistent facts — member preferences, diagnoses" },
  { key: "summary",    label: "Summary",     description: "Conversation summary — written by summary_agent" },
]
const MEMORY_BACKENDS   = [
  { value: "file",      label: "File (local)",  roadmap: false },
  { value: "s3",        label: "S3",            roadmap: true },
  { value: "dynamodb",  label: "DynamoDB",      roadmap: true },
  { value: "redis",     label: "Redis",         roadmap: true },
]
const TRUNCATION_OPTS   = ["tail", "head", "smart"]
const SUMMARY_TRIGGERS  = ["explicit", "turn_count", "token_threshold", "never"]
const SUMMARY_TRIGGER_LABELS: Record<string, string> = {
  explicit: "Explicit (manual only)",
  turn_count: "Turn count threshold",
  token_threshold: "Token threshold",
  never: "Never",
}

const MEMORY_HELP: Record<string, { title: string; body: string; example?: string }> = {
  read:                  { title: "Read", body: "Controls whether the agent retrieves this memory type at the start of each turn. Disable to stop injecting this memory into context — the data is still stored, just not retrieved.", example: "Disable episodic read on a simple FAQ agent that doesn't need past event history." },
  write:                 { title: "Write", body: "Controls whether the agent writes to this memory type after each turn or tool call. Fully independent from read — you can read without writing (read-only mode) or write without reading (audit-only mode).", example: "Disable episodic write in a demo environment to keep the store clean." },
  write_locked:          { title: "Write Locked", body: "Set by the platform based on agent type — not editable. Prevents this agent from ever writing this memory type regardless of other settings.", example: "summary_agent has write_locked=true on episodic and semantic — it can only read them, never write." },
  backend:               { title: "Backend", body: "Where memory records are stored. 'File' stores JSON files on disk — suitable for dev and single-instance deployments. Cloud backends (S3, DynamoDB, Redis) are roadmap items for production multi-instance deployments." },
  max_content_tokens:    { title: "Max Content Tokens", body: "Hard cap on the size of a single memory entry at write time. Any content exceeding this limit is truncated before storage. Prevents one large tool result from consuming the entire context budget when retrieved.", example: "get_care_plan returns 2000 tokens. With max 500, only 500 tokens are stored — the rest is cut." },
  truncation:            { title: "Truncation Strategy", body: "How content is cut when it exceeds max_content_tokens.\n\ntail — keep the first N tokens, cut the end. Fast and cheap. Best for structured data where the key info is at the start.\n\nhead — keep the last N tokens, cut the beginning. Best for conversations where the most recent content matters.\n\nsmart — LLM call to compress the content to fit within budget. Preserves meaning but adds latency and cost." },
  retain_last_n_turns:   { title: "Retain Last N Turns", body: "How many recent conversation turns to keep in short-term memory. Older turns beyond this window are dropped. Trades full context for token efficiency.", example: "retain_last_n_turns: 12 means the agent sees the last 12 user/assistant exchanges." },
  write_intermediate:    { title: "Write Intermediate Steps", body: "Write each reasoning loop iteration (thought → tool call → observation) as short-term memory entries. Only relevant for iterative reasoning strategies.\n\nWhen enabled: full reasoning trace is preserved in memory and visible in context for the next turn.\n\nWhen disabled: only the final user/assistant pair is written.", example: "Nurse asks a complex question. ReAct loops 3 times. With this on, all 3 iterations are stored and visible next turn." },
  write_on_tool_call:    { title: "Write on Tool Call", body: "Automatically write an episodic event after each tool call completes. Creates a permanent record of what the agent did and what the outcome was.", example: "write_case_note executes → episodic entry: 'Tool write_case_note executed. Result: note saved for case C-001.'" },
  tools_trigger:         { title: "Tools That Trigger Write", body: "Which tool calls produce episodic writes.\n\nWrite tools only — only tools with mode=write (e.g. write_case_note). Read tools (get_member, search_kb) produce no episodic trace.\n\nAll tools — every tool call produces an episodic entry including reads. More complete history, higher storage volume." },
  dedup:                 { title: "Deduplication", body: "When the semantic engine extracts a fact that already exists for this scope (same fact_type), update it in place instead of creating a duplicate entry.", example: "Turn 3: member prefers Spanish → stored. Turn 8: same fact extracted again → updates existing entry instead of adding a second 'member prefers Spanish'." },
  summary_trigger:       { title: "Summary Write Trigger", body: "When the summary agent writes a conversation summary.\n\nExplicit — only when manually triggered from the UI.\n\nTurn count — automatically after N turns.\n\nToken threshold — automatically when the short-term store exceeds ~N tokens.\n\nNever — summary writing disabled for this agent." },
  turn_count_threshold:  { title: "Turn Count Threshold", body: "Number of conversation turns after which a summary is automatically written. Each user+assistant exchange counts as one turn.", example: "threshold: 20 → after 20 exchanges, the summary agent writes a summary of the conversation so far." },
  token_threshold:       { title: "Token Threshold", body: "Approximate token count at which the short-term store triggers a summary write. Tokens are estimated at 4 characters per token.", example: "threshold: 8000 → when the conversation history exceeds ~8000 tokens, write a summary." },
}

function MemoryTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const [memoryCfg, setMemoryCfg]   = useState<any>({})
  const [saving, setSaving]         = useState(false)
  const [helpKey, setHelpKey]       = useState<string>("read")

  const reasoningStrategy: string = config.agent?.reasoning?.strategy || "simple"
  const supportsIntermediate = ["react", "multi_hop"].includes(reasoningStrategy)

  useEffect(() => { setMemoryCfg(config.memory || {}) }, [config])

  const save = async () => {
    setSaving(true)
    await onSave("memory", memoryCfg)
    setSaving(false)
  }

  const setReadEnabled = (type: string, val: boolean) =>
    setMemoryCfg((p: any) => ({ ...p, read_policies: { ...(p.read_policies || {}), [type]: { ...(p.read_policies?.[type] || {}), enabled: val } } }))

  const setWriteField = (type: string, field: string, val: any) =>
    setMemoryCfg((p: any) => ({ ...p, write_policies: { ...(p.write_policies || {}), [type]: { ...(p.write_policies?.[type] || {}), [field]: val } } }))

  const setNestedWriteField = (type: string, parent: string, field: string, val: any) =>
    setMemoryCfg((p: any) => {
      const tc = p.write_policies?.[type] || {}
      return { ...p, write_policies: { ...(p.write_policies || {}), [type]: { ...tc, [parent]: { ...(tc[parent] || {}), [field]: val } } } }
    })

  const help = (key: string) => ({ onMouseEnter: () => setHelpKey(key), onFocus: () => setHelpKey(key) })

  // Config summary chips
  const summaryChips = MEMORY_TYPES.map(({ key, label }) => {
    const r = memoryCfg?.read_policies?.[key]
    const w = memoryCfg?.write_policies?.[key]
    const readOn  = r?.enabled !== false
    const writeOn = !!w?.enabled
    const locked  = !!w?.write_locked
    const parts   = [readOn ? "R" : null, locked ? "W🔒" : writeOn ? "W" : null].filter(Boolean)
    if (!parts.length) return null
    return { label, text: parts.join("/"), active: readOn || writeOn }
  }).filter(Boolean)

  const helpContent = MEMORY_HELP[helpKey]

  const savedMemory = config.memory || {}

  return (
    <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
      {/* ── Left: config cards ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <FormControlLabel
            control={<Switch checked={!!memoryCfg.enabled} onChange={e => setMemoryCfg({ ...memoryCfg, enabled: e.target.checked })} />}
            label={<Typography fontWeight={700}>Memory Enabled</Typography>}
          />
          <SavedBadge saved={String(!!savedMemory.enabled)} current={String(!!memoryCfg.enabled)} />
        </Box>

        {MEMORY_TYPES.map(({ key, label, description }) => {
          const rc     = memoryCfg?.read_policies?.[key]  || {}
          const wc     = memoryCfg?.write_policies?.[key] || {}
          const locked = !!wc.write_locked

          return (
            <Paper key={key} variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
              {/* Type header */}
              <Box sx={{ px: 2, py: 1.5, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <Typography fontWeight={700} fontSize={14}>{label}</Typography>
                <Typography variant="caption" color="text.secondary">{description}</Typography>
              </Box>

              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", divide: "vertical" }}>
                {/* READ section */}
                <Box sx={{ p: 2, borderRight: "1px solid #e2e8f0" }}>
                  <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ mb: 1.5, textTransform: "uppercase", letterSpacing: 0.5 }}>Read</Typography>
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    <FormControlLabel
                      {...help("read")}
                      control={<Switch size="small" checked={rc.enabled !== false} onChange={e => setReadEnabled(key, e.target.checked)} />}
                      label={<Typography fontSize={13}>{rc.enabled !== false ? "Enabled" : "Disabled"}</Typography>}
                    />
                    <SavedBadge
                      saved={String(savedMemory?.read_policies?.[key]?.enabled !== false)}
                      current={String(rc.enabled !== false)}
                    />
                  </Box>
                </Box>

                {/* WRITE section */}
                <Box sx={{ p: 2 }}>
                  <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ mb: 1.5, textTransform: "uppercase", letterSpacing: 0.5 }}>Write</Typography>

                  {locked ? (
                    <Tooltip title="Write locked — set by platform based on agent type. Cannot be overridden.">
                      <Box {...help("write_locked")} sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "#94a3b8", cursor: "default", width: "fit-content" }}>
                        <LockIcon sx={{ fontSize: 14 }} />
                        <Typography fontSize={13} color="#94a3b8">Locked by platform</Typography>
                      </Box>
                    </Tooltip>
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      <FormControlLabel
                        {...help("write")}
                        control={<Switch size="small" checked={!!wc.enabled} onChange={e => setWriteField(key, "enabled", e.target.checked)} />}
                        label={<Typography fontSize={13}>{wc.enabled ? "Enabled" : "Disabled"}</Typography>}
                      />
                      <SavedBadge
                        saved={String(!!savedMemory?.write_policies?.[key]?.enabled)}
                        current={String(!!wc.enabled)}
                      />
                    </Box>
                  )}

                  {!locked && (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <FormControl size="small" fullWidth {...help("backend")}>
                          <InputLabel>Backend</InputLabel>
                          <Select value={wc.backend || "file"} label="Backend" onChange={e => setWriteField(key, "backend", e.target.value)}>
                            {MEMORY_BACKENDS.map(b => (
                              <MenuItem key={b.value} value={b.value} disabled={b.roadmap}>
                                {b.label}{b.roadmap ? " (roadmap)" : ""}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <SavedBadge saved={savedMemory?.write_policies?.[key]?.backend || "file"} current={wc.backend || "file"} />
                      </Box>

                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <TextField
                          {...help("max_content_tokens")}
                          size="small" label="Max content tokens" type="number" fullWidth
                          value={wc.max_content_tokens || ""} placeholder="unlimited"
                          onChange={e => setWriteField(key, "max_content_tokens", e.target.value ? Number(e.target.value) : undefined)}
                        />
                        <SavedBadge saved={String(savedMemory?.write_policies?.[key]?.max_content_tokens || "—")} current={String(wc.max_content_tokens || "—")} />
                      </Box>

                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <FormControl size="small" fullWidth {...help("truncation")}>
                          <InputLabel>Truncation</InputLabel>
                          <Select value={wc.truncation || "tail"} label="Truncation" onChange={e => setWriteField(key, "truncation", e.target.value)}>
                            {TRUNCATION_OPTS.map(s => (
                              <MenuItem key={s} value={s}>
                                {s === "tail" ? "Tail — keep start, cut end" : s === "head" ? "Head — keep end, cut start" : "Smart — LLM compress (slow)"}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <SavedBadge saved={savedMemory?.write_policies?.[key]?.truncation || "tail"} current={wc.truncation || "tail"} />
                      </Box>

                      {/* Type-specific write controls */}
                      {key === "short_term" && (
                        <>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <TextField
                              {...help("retain_last_n_turns")}
                              size="small" label="Retain last N turns" type="number" fullWidth
                              value={wc.retain_last_n_turns || ""} placeholder="e.g. 12"
                              onChange={e => setWriteField(key, "retain_last_n_turns", e.target.value ? Number(e.target.value) : undefined)}
                            />
                            <SavedBadge saved={String(savedMemory?.write_policies?.[key]?.retain_last_n_turns || "—")} current={String(wc.retain_last_n_turns || "—")} />
                          </Box>
                          <Tooltip title={supportsIntermediate ? "" : `Not applicable — current strategy is '${reasoningStrategy}'. Enable ReAct or multi-hop to use this.`}>
                            <span>
                              <Box sx={{ display: "flex", alignItems: "center" }}>
                                <FormControlLabel
                                  {...help("write_intermediate")}
                                  disabled={!supportsIntermediate}
                                  control={<Switch size="small" checked={!!wc.write_intermediate_steps} onChange={e => setWriteField(key, "write_intermediate_steps", e.target.checked)} />}
                                  label={
                                    <Typography fontSize={13} color={supportsIntermediate ? "inherit" : "text.disabled"}>
                                      Write intermediate steps
                                      {!supportsIntermediate && <Typography component="span" fontSize={11} sx={{ ml: 0.5 }} color="text.disabled">(ReAct / multi-hop only)</Typography>}
                                    </Typography>
                                  }
                                />
                                <SavedBadge saved={String(!!savedMemory?.write_policies?.[key]?.write_intermediate_steps)} current={String(!!wc.write_intermediate_steps)} />
                              </Box>
                            </span>
                          </Tooltip>
                        </>
                      )}

                      {key === "episodic" && (
                        <>
                          <Box sx={{ display: "flex", alignItems: "center" }}>
                            <FormControlLabel
                              {...help("write_on_tool_call")}
                              control={<Switch size="small" checked={!!wc.write_on_tool_call?.enabled} onChange={e => setNestedWriteField(key, "write_on_tool_call", "enabled", e.target.checked)} />}
                              label={<Typography fontSize={13}>Write on tool call</Typography>}
                            />
                            <SavedBadge saved={String(!!savedMemory?.write_policies?.[key]?.write_on_tool_call?.enabled)} current={String(!!wc.write_on_tool_call?.enabled)} />
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <FormControl size="small" fullWidth disabled={!wc.write_on_tool_call?.enabled} {...help("tools_trigger")}>
                              <InputLabel>Tools that trigger write</InputLabel>
                              <Select value={wc.write_on_tool_call?.tools || "write_only"} label="Tools that trigger write"
                                onChange={e => setNestedWriteField(key, "write_on_tool_call", "tools", e.target.value)}>
                                <MenuItem value="write_only">Write tools only</MenuItem>
                                <MenuItem value="all">All tools</MenuItem>
                              </Select>
                            </FormControl>
                            <SavedBadge saved={savedMemory?.write_policies?.[key]?.write_on_tool_call?.tools || "write_only"} current={wc.write_on_tool_call?.tools || "write_only"} />
                          </Box>
                        </>
                      )}

                      {key === "semantic" && (
                        <Box sx={{ display: "flex", alignItems: "center" }}>
                          <FormControlLabel
                            {...help("dedup")}
                            control={<Switch size="small" checked={!!wc.dedup?.enabled} onChange={e => setNestedWriteField(key, "dedup", "enabled", e.target.checked)} />}
                            label={<Typography fontSize={13}>Deduplication</Typography>}
                          />
                          <SavedBadge saved={String(!!savedMemory?.write_policies?.[key]?.dedup?.enabled)} current={String(!!wc.dedup?.enabled)} />
                        </Box>
                      )}

                      {key === "summary" && (
                        <>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <FormControl size="small" fullWidth {...help("summary_trigger")}>
                              <InputLabel>Write trigger</InputLabel>
                              <Select value={wc.trigger || "explicit"} label="Write trigger" onChange={e => setWriteField(key, "trigger", e.target.value)}>
                                {SUMMARY_TRIGGERS.map(t => <MenuItem key={t} value={t}>{SUMMARY_TRIGGER_LABELS[t]}</MenuItem>)}
                              </Select>
                            </FormControl>
                            <SavedBadge saved={savedMemory?.write_policies?.[key]?.trigger || "explicit"} current={wc.trigger || "explicit"} />
                          </Box>
                          {wc.trigger === "turn_count" && (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <TextField {...help("turn_count_threshold")} size="small" label="Turn threshold" type="number" fullWidth
                                value={wc.turn_count_threshold || 20} onChange={e => setWriteField(key, "turn_count_threshold", Number(e.target.value))} />
                              <SavedBadge saved={String(savedMemory?.write_policies?.[key]?.turn_count_threshold || 20)} current={String(wc.turn_count_threshold || 20)} />
                            </Box>
                          )}
                          {wc.trigger === "token_threshold" && (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <TextField {...help("token_threshold")} size="small" label="Token threshold" type="number" fullWidth
                                value={wc.token_threshold || 8000} onChange={e => setWriteField(key, "token_threshold", Number(e.target.value))} />
                              <SavedBadge saved={String(savedMemory?.write_policies?.[key]?.token_threshold || 8000)} current={String(wc.token_threshold || 8000)} />
                            </Box>
                          )}
                        </>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            </Paper>
          )
        })}

        {/* Config summary */}
        {summaryChips.length > 0 && (
          <Box sx={{ p: 2, bgcolor: "#f8fafc", borderRadius: 2, border: "1px solid #e2e8f0" }}>
            <Typography fontSize={12} fontWeight={600} color="text.secondary" sx={{ mb: 1 }}>Active configuration</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {summaryChips.map((c: any) => (
                <Chip key={c.label} label={`${c.label}: ${c.text}`} size="small"
                  variant={c.active ? "filled" : "outlined"}
                  color={c.active ? "primary" : "default"}
                  sx={{ fontSize: 12 }}
                />
              ))}
            </Box>
          </Box>
        )}

        <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
          {saving ? "Saving…" : "Save Memory Config"}
        </Button>
      </Box>

      {/* ── Right: contextual help panel ── */}
      <Box sx={{ width: 260, flexShrink: 0, position: "sticky", top: 0 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "#fafafa" }}>
          <Typography fontSize={12} fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
            {helpContent?.title || "Hover any field for help"}
          </Typography>
          {helpContent && (
            <>
              <Typography fontSize={12} color="text.secondary" sx={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>
                {helpContent.body}
              </Typography>
              {helpContent.example && (
                <Box sx={{ mt: 1.5, p: 1.5, bgcolor: "#f0f4ff", borderRadius: 1, borderLeft: "3px solid #6366f1" }}>
                  <Typography fontSize={11} color="#4338ca" sx={{ lineHeight: 1.5 }}>
                    <strong>Example:</strong> {helpContent.example}
                  </Typography>
                </Box>
              )}
            </>
          )}
          <Divider sx={{ my: 1.5 }} />
          <Typography fontSize={11} color="text.disabled">
            Reasoning strategy: <strong>{reasoningStrategy}</strong>
          </Typography>
        </Paper>
      </Box>
    </Box>
  )
}

const DIM1_ALL_STRATEGIES = [
  { value: "semantic",  label: "Semantic (vector similarity)",       roadmap: false, description: "Search by meaning using embeddings via pgvector." },
  { value: "keyword",   label: "Keyword (BM25 full-text)",           roadmap: false, description: "PostgreSQL full-text search. Fast for exact/fuzzy word matching." },
  { value: "hybrid",    label: "Hybrid (vector + BM25, RRF merge)",  roadmap: false, description: "Combines dense vector and sparse keyword search. Best of both worlds." },
  { value: "graph",     label: "Graph RAG (Neo4j)",                  roadmap: true,  description: "Traverses entity relationships to find connected nodes. Requires Neo4j." },
]

const DIM3_ALL_PATTERNS = [
  { value: "naive",           label: "Naive",           roadmap: false, description: "Single retrieve → inject → respond. No retry." },
  { value: "self_corrective", label: "Self-Corrective", roadmap: false, description: "Retrieve → grade quality → re-query with refined query if poor." },
  { value: "multi_hop",       label: "Multi-Hop",       roadmap: true,  description: "Decompose query → retrieve per sub-question → synthesize." },
  { value: "hyde",            label: "HyDE",            roadmap: true,  description: "Generate hypothetical answer first → embed → retrieve." },
  { value: "agentic",         label: "Agentic",         roadmap: true,  description: "LLM decides when and how many times to retrieve mid-reasoning." },
]

const RAG_HELP: Record<string, { title: string; body: string; example?: string }> = {
  dim1_strategy: { title: "Dimension 1 — Search Strategy", body: "How documents are retrieved from the knowledge base.\n\nSemantic — embeds the query and finds chunks with similar meaning via pgvector.\n\nKeyword — PostgreSQL full-text BM25. Fast for exact/fuzzy word matching.\n\nHybrid — runs both in parallel, merges results via Reciprocal Rank Fusion (RRF). Best recall, slightly higher latency.", example: "Clinical policy KB: hybrid. FAQ KB: keyword is often sufficient." },
  dim3_pattern:  { title: "Dimension 3 — Retrieval Pattern", body: "Controls how many retrieval attempts happen and whether the agent self-evaluates results.\n\nNaive — single retrieve, inject, respond. Cheapest.\n\nSelf-Corrective — retrieve → LLM grades relevance → re-query if poor. Better recall at ~1.5× cost.\n\nMulti-Hop / HyDE / Agentic — roadmap.", example: "Time-pressured workflow (nurses): naive or self_corrective. Research workflow: multi_hop." },
  pre_graph:     { title: "Pre-Graph RAG (Dim 2 — Stage 1)", body: "Retrieves KB chunks BEFORE the planner runs and injects them silently into context. No explicit tool call needed — the planner always sees the retrieved content.\n\nBest for: chat_agent, workflow_agent.\nNot for: react_agent (which manages its own retrieval mid-loop).", example: "User asks about a prior auth policy. Pre-graph retrieves the policy doc before the planner even sees the question." },
  planner_tool:  { title: "Planner Tool RAG (Dim 2 — Stage 2)", body: "Exposes search_kb as a callable tool to the planner LLM. The planner decides when to call it — only on KB questions.\n\nMore selective than pre-graph — no retrieval cost on turns that don't need it.\n\nBest for: chat_agent, react_agent.\nNot for: summary_agent.", example: "Member case question → planner calls get_case. Policy question → planner calls search_kb." },
  top_k:         { title: "Top K", body: "Max number of chunks to retrieve. Higher K = more context, more tokens, higher cost.\n\nPre-graph: keep low (2–4) — injected every turn.\nPlanner tool: 4–6 — only triggered when needed.", example: "top_k: 3 returns 3 chunks. At ~300 tokens each, that's ~900 tokens added to context every turn." },
  threshold:     { title: "Similarity Threshold", body: "Minimum cosine similarity score for a chunk to be returned. Chunks below this are discarded even if in the top K.\n\nHigher → more selective, less noise.\nLower → more recall, more noise.", example: "0.5 = only highly relevant chunks. 0.2 = returns almost everything — useful for sparse KBs." },
  fallback:      { title: "Allow No-Results Response", body: "When ON: if search returns no results above threshold, the LLM answers from general knowledge with a disclaimer.\n\nWhen OFF: returns a fixed 'no relevant knowledge found' message and stops. Use for strict compliance scenarios where hallucination is worse than no answer." },
  kb_tool:       { title: "KB Tool", body: "The knowledge base tool to call for retrieval. Comes from tools assigned to this agent in the Tools tab tagged 'retrieval'.\n\nEach stage can use a different KB tool — e.g. pre-graph on a broad policy KB, planner tool on a narrower clinical guidelines KB." },
}

function RagTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void>; agent: AgentRecord }) {
  const [retrieval, setRetrieval] = useState<any>({})
  const [gatewayTools, setGatewayTools] = useState<any[]>([])
  const [saving, setSaving]   = useState(false)
  const [helpKey, setHelpKey] = useState<string>("dim1_strategy")

  useEffect(() => { setRetrieval(config.agent?.retrieval || {}) }, [config])
  useEffect(() => {
    getGatewayTools().then(res => setGatewayTools(res.data?.tools || [])).catch(() => {})
  }, [])

  const retrievalTools = gatewayTools.filter(t => t.tags?.includes("retrieval"))
  const allowedTools: string[] = config.agent?.tools?.allowed || []
  const assignedRetrievalTools = retrievalTools.filter(t => allowedTools.includes(t.name))

  const save = async () => {
    setSaving(true)
    await onSave("agent", { retrieval })
    setSaving(false)
  }

  const help = (key: string) => ({ onMouseEnter: () => setHelpKey(key), onFocus: () => setHelpKey(key) })
  const helpContent = RAG_HELP[helpKey]

  const savedRag = config.agent?.retrieval || {}

  return (
    <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
      {/* ── Left: config ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <FormControlLabel
          control={<Switch checked={!!retrieval.enabled} onChange={e => setRetrieval({ ...retrieval, enabled: e.target.checked })} />}
          label={<Typography fontWeight={700}>RAG Enabled</Typography>}
        />
        <SavedBadge saved={String(!!savedRag.enabled)} current={String(!!retrieval.enabled)} />
      </Box>

      {/* Dimension 1 — Strategy */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>Dimension 1 — Search Strategy</Typography>
          <Chip label="Dim 1" size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <FormControl size="small" sx={{ minWidth: 280 }} {...help("dim1_strategy")}>
          <InputLabel>Strategy</InputLabel>
          <Select
            value={retrieval.strategy || "semantic"}
            label="Strategy"
            onChange={e => setRetrieval({ ...retrieval, strategy: e.target.value })}
          >
            {DIM1_ALL_STRATEGIES.map(s => (
              <MenuItem key={s.value} value={s.value} disabled={s.roadmap}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box>
                    <Typography variant="body2" fontWeight={500} sx={{ color: s.roadmap ? "#9ca3af" : "inherit" }}>{s.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                  </Box>
                  {s.roadmap && <Chip label="roadmap" size="small" sx={{ ml: "auto", fontSize: 10, height: 18, bgcolor: "#f3f4f6", color: "#9ca3af" }} />}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <SavedBadge saved={savedRag.strategy || "semantic"} current={retrieval.strategy || "semantic"} />
        </Box>

        {assignedRetrievalTools.length > 0 && (
          <Table size="small" sx={{ mb: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Assigned KB Tool</TableCell>
                <TableCell>DB Type</TableCell>
                <TableCell>Tool Strategy</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignedRetrievalTools.map(t => (
                <TableRow key={t.name}>
                  <TableCell sx={{ fontWeight: 500 }}>{t.name}</TableCell>
                  <TableCell><Chip label={t.db_type || "—"} size="small" variant="outlined" /></TableCell>
                  <TableCell><Chip label={t.strategy || "—"} size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600 }} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>

      <Divider />

      {/* Dimension 3 — Pattern */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>Dimension 3 — Retrieval Pattern</Typography>
          <Chip label="Dim 3" size="small" sx={{ bgcolor: "#ede9fe", color: "#5b21b6", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <FormControl size="small" sx={{ minWidth: 280 }} {...help("dim3_pattern")}>
          <InputLabel>Pattern</InputLabel>
          <Select
            value={retrieval.pattern || "naive"}
            label="Pattern"
            onChange={e => setRetrieval({ ...retrieval, pattern: e.target.value })}
          >
            {DIM3_ALL_PATTERNS.map(p => (
              <MenuItem key={p.value} value={p.value} disabled={p.roadmap}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box>
                    <Typography variant="body2" fontWeight={500} sx={{ color: p.roadmap ? "#9ca3af" : "inherit" }}>{p.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.description}</Typography>
                  </Box>
                  {p.roadmap && <Chip label="roadmap" size="small" sx={{ ml: "auto", fontSize: 10, height: 18, bgcolor: "#f3f4f6", color: "#9ca3af" }} />}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Divider />

      {/* Pre-graph RAG — fully independent config */}
      {/* Pre-Graph RAG */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.5, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 1 }}>
          <Typography fontWeight={700} fontSize={14}>Pre-Graph RAG</Typography>
          <Chip label="Dim 2 — Stage 1" size="small" sx={{ bgcolor: "#ede9fe", color: "#5b21b6", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <FormControlLabel {...help("pre_graph")}
              control={<Switch checked={!!retrieval.pre_graph?.enabled}
                onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, enabled: e.target.checked } })} />}
              label={<Typography fontSize={13}>{retrieval.pre_graph?.enabled ? "Enabled" : "Disabled"}</Typography>}
            />
            <SavedBadge saved={String(!!savedRag.pre_graph?.enabled)} current={String(!!retrieval.pre_graph?.enabled)} />
          </Box>
          {retrieval.pre_graph?.enabled && <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FormControl size="small" sx={{ maxWidth: 280 }} {...help("kb_tool")}>
                <InputLabel>KB Tool</InputLabel>
                <Select value={retrieval.pre_graph?.tool || "search_kb"} label="KB Tool"
                  onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, tool: e.target.value } })}>
                  {assignedRetrievalTools.length > 0
                    ? assignedRetrievalTools.map(t => <MenuItem key={t.name} value={t.name}>{t.name}</MenuItem>)
                    : <MenuItem value="search_kb">search_kb</MenuItem>}
                </Select>
              </FormControl>
              <SavedBadge saved={savedRag.pre_graph?.tool || "search_kb"} current={retrieval.pre_graph?.tool || "search_kb"} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FormControl size="small" sx={{ maxWidth: 280 }} {...help("dim1_strategy")}>
                <InputLabel>Strategy (Dim 1)</InputLabel>
                <Select value={retrieval.pre_graph?.strategy || "semantic"} label="Strategy (Dim 1)"
                  onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, strategy: e.target.value } })}>
                  {DIM1_ALL_STRATEGIES.map(s => <MenuItem key={s.value} value={s.value} disabled={s.roadmap}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" sx={{ color: s.roadmap ? "#9ca3af" : "inherit" }}>{s.label}</Typography>
                      {s.roadmap && <Chip label="roadmap" size="small" sx={{ fontSize: 10, height: 18, bgcolor: "#f3f4f6", color: "#9ca3af" }} />}
                    </Box>
                  </MenuItem>)}
                </Select>
              </FormControl>
              <SavedBadge saved={savedRag.pre_graph?.strategy || "semantic"} current={retrieval.pre_graph?.strategy || "semantic"} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FormControl size="small" sx={{ maxWidth: 280 }} {...help("dim3_pattern")}>
                <InputLabel>Pattern (Dim 3)</InputLabel>
                <Select value={retrieval.pre_graph?.pattern || "naive"} label="Pattern (Dim 3)"
                  onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, pattern: e.target.value } })}>
                  {DIM3_ALL_PATTERNS.map(p => <MenuItem key={p.value} value={p.value} disabled={p.roadmap}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" sx={{ color: p.roadmap ? "#9ca3af" : "inherit" }}>{p.label}</Typography>
                      {p.roadmap && <Chip label="roadmap" size="small" sx={{ fontSize: 10, height: 18, bgcolor: "#f3f4f6", color: "#9ca3af" }} />}
                    </Box>
                  </MenuItem>)}
                </Select>
              </FormControl>
              <SavedBadge saved={savedRag.pre_graph?.pattern || "naive"} current={retrieval.pre_graph?.pattern || "naive"} />
            </Box>
            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TextField size="small" label="Top K" type="number" sx={{ maxWidth: 120 }}
                  value={retrieval.pre_graph?.top_k ?? 3}
                  onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, top_k: Number(e.target.value) } })}
                  {...help("top_k")} />
                <SavedBadge saved={String(savedRag.pre_graph?.top_k ?? 3)} current={String(retrieval.pre_graph?.top_k ?? 3)} />
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TextField size="small" label="Threshold" type="number" inputProps={{ step: 0.05, min: 0, max: 1 }} sx={{ maxWidth: 140 }}
                  value={retrieval.pre_graph?.similarity_threshold ?? 0.5}
                  onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, similarity_threshold: Number(e.target.value) } })}
                  {...help("threshold")} />
                <SavedBadge saved={String(savedRag.pre_graph?.similarity_threshold ?? 0.5)} current={String(retrieval.pre_graph?.similarity_threshold ?? 0.5)} />
              </Box>
            </Box>
          </>}
        </Box>
      </Paper>

      {/* Planner Tool RAG */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.5, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 1 }}>
          <Typography fontWeight={700} fontSize={14}>Planner Tool RAG</Typography>
          <Chip label="Dim 2 — Stage 2" size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <FormControlLabel {...help("planner_tool")}
              control={<Switch checked={!!retrieval.planner_tool?.enabled}
                onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, enabled: e.target.checked } })} />}
              label={<Typography fontSize={13}>{retrieval.planner_tool?.enabled ? "Enabled" : "Disabled"}</Typography>}
            />
            <SavedBadge saved={String(!!savedRag.planner_tool?.enabled)} current={String(!!retrieval.planner_tool?.enabled)} />
          </Box>
          {retrieval.planner_tool?.enabled && <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FormControl size="small" sx={{ maxWidth: 280 }} {...help("kb_tool")}>
                <InputLabel>KB Tool</InputLabel>
                <Select value={retrieval.planner_tool?.tool || "search_kb"} label="KB Tool"
                  onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, tool: e.target.value } })}>
                  {assignedRetrievalTools.length > 0
                    ? assignedRetrievalTools.map(t => <MenuItem key={t.name} value={t.name}>{t.name}</MenuItem>)
                    : <MenuItem value="search_kb">search_kb</MenuItem>}
                </Select>
              </FormControl>
              <SavedBadge saved={savedRag.planner_tool?.tool || "search_kb"} current={retrieval.planner_tool?.tool || "search_kb"} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FormControl size="small" sx={{ maxWidth: 280 }} {...help("dim1_strategy")}>
                <InputLabel>Strategy (Dim 1)</InputLabel>
                <Select value={retrieval.planner_tool?.strategy || "semantic"} label="Strategy (Dim 1)"
                  onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, strategy: e.target.value } })}>
                  {DIM1_ALL_STRATEGIES.map(s => <MenuItem key={s.value} value={s.value} disabled={s.roadmap}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" sx={{ color: s.roadmap ? "#9ca3af" : "inherit" }}>{s.label}</Typography>
                      {s.roadmap && <Chip label="roadmap" size="small" sx={{ fontSize: 10, height: 18, bgcolor: "#f3f4f6", color: "#9ca3af" }} />}
                    </Box>
                  </MenuItem>)}
                </Select>
              </FormControl>
              <SavedBadge saved={savedRag.planner_tool?.strategy || "semantic"} current={retrieval.planner_tool?.strategy || "semantic"} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <FormControl size="small" sx={{ maxWidth: 280 }} {...help("dim3_pattern")}>
                <InputLabel>Pattern (Dim 3)</InputLabel>
                <Select value={retrieval.planner_tool?.pattern || "naive"} label="Pattern (Dim 3)"
                  onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, pattern: e.target.value } })}>
                  {DIM3_ALL_PATTERNS.map(p => <MenuItem key={p.value} value={p.value} disabled={p.roadmap}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" sx={{ color: p.roadmap ? "#9ca3af" : "inherit" }}>{p.label}</Typography>
                      {p.roadmap && <Chip label="roadmap" size="small" sx={{ fontSize: 10, height: 18, bgcolor: "#f3f4f6", color: "#9ca3af" }} />}
                    </Box>
                  </MenuItem>)}
                </Select>
              </FormControl>
              <SavedBadge saved={savedRag.planner_tool?.pattern || "naive"} current={retrieval.planner_tool?.pattern || "naive"} />
            </Box>
            <Box sx={{ display: "flex", gap: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TextField size="small" label="Top K" type="number" sx={{ maxWidth: 120 }}
                  value={retrieval.planner_tool?.top_k ?? 5}
                  onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, top_k: Number(e.target.value) } })}
                  {...help("top_k")} />
                <SavedBadge saved={String(savedRag.planner_tool?.top_k ?? 5)} current={String(retrieval.planner_tool?.top_k ?? 5)} />
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TextField size="small" label="Threshold" type="number" inputProps={{ step: 0.05, min: 0, max: 1 }} sx={{ maxWidth: 140 }}
                  value={retrieval.planner_tool?.similarity_threshold ?? 0.35}
                  onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, similarity_threshold: Number(e.target.value) } })}
                  {...help("threshold")} />
                <SavedBadge saved={String(savedRag.planner_tool?.similarity_threshold ?? 0.35)} current={String(retrieval.planner_tool?.similarity_threshold ?? 0.35)} />
              </Box>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <FormControlLabel {...help("fallback")}
                control={<Switch checked={!!retrieval.planner_tool?.fallback?.allow_no_results_response}
                  onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, fallback: { allow_no_results_response: e.target.checked } } })} />}
                label={<Typography fontSize={13}>Allow No-Results Response</Typography>}
              />
              <SavedBadge saved={String(!!savedRag.planner_tool?.fallback?.allow_no_results_response)} current={String(!!retrieval.planner_tool?.fallback?.allow_no_results_response)} />
            </Box>
          </>}
        </Box>
      </Paper>

      <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save RAG"}
      </Button>
      </Box>

      {/* ── Right: contextual help panel ── */}
      <Box sx={{ width: 260, flexShrink: 0, position: "sticky", top: 0 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "#fafafa" }}>
          <Typography fontSize={12} fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
            {helpContent?.title || "Hover any field for help"}
          </Typography>
          {helpContent && (
            <>
              <Typography fontSize={12} color="text.secondary" sx={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>
                {helpContent.body}
              </Typography>
              {helpContent.example && (
                <Box sx={{ mt: 1.5, p: 1.5, bgcolor: "#f0f4ff", borderRadius: 1, borderLeft: "3px solid #6366f1" }}>
                  <Typography fontSize={11} color="#4338ca" sx={{ lineHeight: 1.5 }}>
                    <strong>Example:</strong> {helpContent.example}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </Paper>
      </Box>
    </Box>
  )
}

function PromptsTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const p = config.prompts || {}
    const flat: Record<string, string> = {}
    for (const [k, v] of Object.entries(p)) { flat[k] = typeof v === "string" ? v : "" }
    setPrompts(flat)
  }, [config])

  const save = async () => {
    setSaving(true)
    await onSave("prompts", prompts)
    setSaving(false)
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {Object.entries(prompts).map(([key, val]) => (
        <Box key={key}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{key}</Typography>
          <TextField
            multiline
            minRows={4}
            fullWidth
            value={val}
            onChange={e => setPrompts({ ...prompts, [key]: e.target.value })}
            size="small"
          />
        </Box>
      ))}
      <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save Prompts"}
      </Button>
    </Box>
  )
}

const ROUTING_HELP: Record<string, { title: string; body: string; example?: string }> = {
  overview: {
    title: "Hard Routes — What & When",
    body: "Hard routes fire BEFORE the LLM planner. If any trigger phrase matches the user message, the route executes the tool directly — no LLM call, no reasoning loop.\n\nWhen to use:\n• High-frequency, predictable queries where the answer is always the same tool call\n• Zero tolerance for hallucination (the tool must always be called exactly)\n• Cost optimization — avoid LLM cost on routine lookups\n\nWhen NOT to use:\n• Queries that need reasoning or depend on context\n• When the tool argument varies based on what the user said\n• When you're not sure — leave it to the planner",
    example: "User always says 'show me the assessment' → hard route → get_assessment_summary. No LLM needed.",
  },
  phrases: {
    title: "Trigger Phrases",
    body: "Substring match against the lowercased user message. If ANY phrase in the list is found, the route fires.\n\nKeep phrases specific enough to avoid false positives. Broad phrases like 'show' or 'get' will match unintended messages.\n\nMatching is case-insensitive and substring-based — 'assessment' matches 'show me the assessment details'.",
    example: "'show assessment', 'open assessment', 'assessment summary' → all trigger the same route.",
  },
  scope: {
    title: "Scope",
    body: "Which context scope provides the ID passed to the tool. The active scope ID is resolved from the current session context (member_id, case_id, assessment_id, etc.) at runtime.\n\nMust match a scope defined in domain.yaml — the ID field for that scope will be injected as the tool argument.",
    example: "scope: assessment → assessment_id is read from context and passed to get_assessment_summary.",
  },
  tool: {
    title: "Tool",
    body: "Which Tool Gateway tool to call when this route fires. Must be in the agent's allowed tools list (configured in the Tools tab).\n\nThe tool is called with the resolved scope ID as its primary argument.",
    example: "tool: get_assessment_summary → calls the assessment summary tool with the active assessment_id.",
  },
  argument_template: {
    title: "Argument Template",
    body: "Template for the tool argument. Variables:\n• {scope_id} — the active scope ID resolved from context\n• {prompt} — the raw user message\n\nMost routes use {scope_id}. Use {prompt} only if the tool takes a free-text query (e.g. search_kb).",
    example: "{scope_id} → passes assessment_id directly. {prompt} → passes the user's question to search_kb.",
  },
}

function RoutingTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const agentCfg = config.agent || {}
  const domainScopes: Array<{ name: string; id_field: string }> = (config as any)?.domain?.scopes || []

  type HardRoute = { phrases: string[]; scope: string; tool: string; argument_template?: string }
  const [routes, setRoutes]             = useState<HardRoute[]>([])
  const [toolSpecs, setToolSpecs]       = useState<Record<string, any>>({})  // name → spec
  const [saving, setSaving]             = useState(false)
  const [helpKey, setHelpKey]           = useState<string>("overview")
  const [newPhrase, setNewPhrase]       = useState<Record<number, string>>({})

  const gatewayTools = Object.keys(toolSpecs)

  const help = (key: string) => ({ onMouseEnter: () => setHelpKey(key), onFocus: () => setHelpKey(key) })

  useEffect(() => {
    setRoutes(agentCfg?.hard_routes || [])
  }, [config])

  useEffect(() => {
    getGatewayTools()
      .then(res => {
        const specs: Record<string, any> = {}
        ;(res.data?.tools || []).forEach((t: any) => { specs[t.name] = t })
        setToolSpecs(specs)
      })
      .catch(() => {})
  }, [])

  // Validate scope ↔ tool: scope's id_field must match tool's primary_arg
  const validateRoute = (route: HardRoute): string | null => {
    if (!route.scope || !route.tool) return null
    const scope = domainScopes.find(s => s.name === route.scope)
    const spec  = toolSpecs[route.tool]
    if (!scope || !spec?.primary_arg) return null
    if (scope.id_field !== spec.primary_arg) {
      return `Scope "${route.scope}" provides ${scope.id_field} but ${route.tool} expects ${spec.primary_arg}`
    }
    return null
  }

  const updateRoute = (i: number, field: keyof HardRoute, value: any) => {
    const next = [...routes]; next[i] = { ...next[i], [field]: value }; setRoutes(next)
  }

  const addPhrase = (i: number) => {
    const phrase = (newPhrase[i] || "").trim()
    if (!phrase) return
    updateRoute(i, "phrases", [...(routes[i].phrases || []), phrase])
    setNewPhrase({ ...newPhrase, [i]: "" })
  }

  const removePhrase = (i: number, pi: number) => {
    updateRoute(i, "phrases", routes[i].phrases.filter((_, j) => j !== pi))
  }

  const addRoute = () => setRoutes([...routes, { phrases: [], scope: "", tool: "", argument_template: "{scope_id}" }])
  const removeRoute = (i: number) => setRoutes(routes.filter((_, j) => j !== i))

  const save = async () => {
    setSaving(true)
    await onSave("agent", { hard_routes: routes })
    setSaving(false)
  }

  const helpContent = ROUTING_HELP[helpKey]

  const savedRoutes: any[] = agentCfg?.hard_routes || []

  return (
    <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
      {/* ── Left: config ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>

        {/* Header */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }} {...help("overview")}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <Typography fontWeight={700} fontSize={14}>Hard Routes</Typography>
            <Typography variant="caption" color="text.secondary">
              Deterministic phrase matching → tool call, fires before the LLM planner
            </Typography>
          </Box>
          <Box sx={{ px: 2, py: 1.5, display: "flex", gap: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#22c55e" }} />
              <Typography fontSize={12} color="text.secondary">Zero LLM cost on match</Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#6366f1" }} />
              <Typography fontSize={12} color="text.secondary">{routes.length} route{routes.length !== 1 ? "s" : ""} configured</Typography>
            </Box>
          </Box>
        </Paper>

        {/* Current config summary table */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <Box sx={{ px: 2, py: 1.2, bgcolor: "#fefce8", borderBottom: "1px solid #fde68a", display: "flex", alignItems: "center", gap: 1 }}>
            <Typography fontSize={12} fontWeight={700} color="#854d0e" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>Saved Configuration</Typography>
          </Box>
          {savedRoutes.length === 0 ? (
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography fontSize={12} color="#94a3b8" fontStyle="italic">No routes configured</Typography>
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Route</TableCell>
                  <TableCell>Phrases</TableCell>
                  <TableCell>Scope</TableCell>
                  <TableCell>Tool</TableCell>
                  <TableCell>Argument</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {savedRoutes.map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontWeight: 600, color: "#854d0e" }}>#{i + 1}</TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                        {(r.phrases || []).map((p: string, pi: number) => (
                          <Chip key={pi} label={p} size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#fefce8", color: "#854d0e", border: "1px solid #fde68a" }} />
                        ))}
                        {(!r.phrases || r.phrases.length === 0) && <Typography fontSize={11} color="text.disabled">—</Typography>}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.scope || "—"}</TableCell>
                    <TableCell sx={{ fontSize: 12, fontWeight: 500 }}>{r.tool || "—"}</TableCell>
                    <TableCell sx={{ fontSize: 11, color: "#64748b" }}>{r.argument_template || "{scope_id}"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        {/* Routes */}
        {routes.map((route, i) => (
          <Paper key={i} variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
            <Box sx={{ px: 2, py: 1.2, bgcolor: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography fontSize={13} fontWeight={700}>Route {i + 1}</Typography>
                {i >= savedRoutes.length && <Chip label="new" size="small" sx={{ height: 16, fontSize: 10, bgcolor: "#fefce8", color: "#854d0e", border: "1px solid #fde68a", fontWeight: 700 }} />}
              </Box>
              <IconButton size="small" onClick={() => removeRoute(i)}><DeleteIcon fontSize="small" /></IconButton>
            </Box>

            <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>

              {/* Phrases */}
              <Box {...help("phrases")}>
                <Typography fontSize={11} fontWeight={700} color="text.secondary" sx={{ mb: 1, textTransform: "uppercase", letterSpacing: 0.5 }}>Trigger Phrases</Typography>
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
                  {(route.phrases || []).map((p, pi) => {
                    const isSaved = (savedRoutes[i]?.phrases || []).includes(p)
                    return (
                      <Chip key={pi} label={p} size="small" onDelete={() => removePhrase(i, pi)}
                        sx={{
                          fontSize: 12,
                          bgcolor: isSaved ? "#f0fdf4" : "#fefce8",
                          color: isSaved ? "#15803d" : "#854d0e",
                          border: `1px solid ${isSaved ? "#bbf7d0" : "#fde68a"}`,
                          fontWeight: 600,
                          "& .MuiChip-deleteIcon": { color: isSaved ? "#16a34a" : "#b45309" },
                        }}
                      />
                    )
                  })}
                  {/* Removed phrases — in saved but not in current */}
                  {(savedRoutes[i]?.phrases || []).filter((p: string) => !(route.phrases || []).includes(p)).map((p: string, pi: number) => (
                    <Chip key={`removed-${pi}`} label={p} size="small"
                      sx={{ fontSize: 12, bgcolor: "#fff1f2", color: "#9f1239", border: "1px solid #fecdd3", fontWeight: 600, textDecoration: "line-through", opacity: 0.7 }}
                    />
                  ))}
                  {route.phrases.length === 0 && !(savedRoutes[i]?.phrases?.length) && (
                    <Typography fontSize={12} color="text.disabled">No phrases yet — add below</Typography>
                  )}
                </Box>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <TextField
                    size="small"
                    placeholder="e.g. show assessment"
                    value={newPhrase[i] || ""}
                    onChange={e => setNewPhrase({ ...newPhrase, [i]: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter") addPhrase(i) }}
                    sx={{ flex: 1 }}
                  />
                  <Button size="small" variant="outlined" onClick={() => addPhrase(i)}>Add</Button>
                </Box>
              </Box>

              {/* Scope + Tool + Arg */}
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1.5 }}>
                <Box>
                  <FormControl size="small" fullWidth {...help("scope")}>
                    <InputLabel>Scope</InputLabel>
                    <Select value={route.scope} label="Scope" onChange={e => updateRoute(i, "scope", e.target.value)}>
                      {domainScopes.length > 0
                        ? domainScopes.map(s => (
                            <MenuItem key={s.name} value={s.name}>
                              {s.name} <Typography component="span" fontSize={11} color="text.secondary" sx={{ ml: 0.5 }}>({s.id_field})</Typography>
                            </MenuItem>
                          ))
                        : <MenuItem value={route.scope}>{route.scope || "—"}</MenuItem>
                      }
                    </Select>
                  </FormControl>
                  <SavedBadge saved={savedRoutes[i]?.scope || "—"} current={route.scope || "—"} />
                </Box>

                <Box>
                  <FormControl size="small" fullWidth {...help("tool")}>
                    <InputLabel>Tool</InputLabel>
                    <Select value={route.tool} label="Tool" onChange={e => updateRoute(i, "tool", e.target.value)}>
                      {gatewayTools.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <SavedBadge saved={savedRoutes[i]?.tool || "—"} current={route.tool || "—"} />
                </Box>

                <Box>
                  <TextField
                    size="small"
                    fullWidth
                    label="Argument template"
                    value={route.argument_template || "{scope_id}"}
                    onChange={e => updateRoute(i, "argument_template", e.target.value)}
                    helperText="{scope_id} or {prompt}"
                    {...help("argument_template")}
                  />
                  <SavedBadge saved={savedRoutes[i]?.argument_template || "{scope_id}"} current={route.argument_template || "{scope_id}"} />
                </Box>
              </Box>

              {/* Scope ↔ tool validation warning */}
              {(() => {
                const warn = validateRoute(route)
                return warn ? (
                  <Box sx={{ p: 1.5, bgcolor: "#fff7ed", borderRadius: 1, border: "1px solid #fed7aa", display: "flex", alignItems: "flex-start", gap: 1 }}>
                    <Typography fontSize={12} color="#c2410c" sx={{ lineHeight: 1.5 }}>
                      ⚠ <strong>Scope/tool mismatch:</strong> {warn}
                    </Typography>
                  </Box>
                ) : null
              })()}

              {/* Route preview */}
              {route.phrases.length > 0 && route.tool && !validateRoute(route) && (
                <Box sx={{ p: 1.5, bgcolor: "#f8fafc", borderRadius: 1, border: "1px solid #e2e8f0" }}>
                  <Typography fontSize={11} color="text.secondary">
                    <strong>Preview:</strong> if message contains <strong>"{route.phrases[0]}"</strong>
                    {route.phrases.length > 1 ? ` (+ ${route.phrases.length - 1} more)` : ""} →{" "}
                    call <strong>{route.tool}</strong>({route.argument_template || "{scope_id}"})
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>
        ))}

        <Button size="small" startIcon={<AddIcon />} onClick={addRoute} sx={{ alignSelf: "flex-start" }}>
          Add Route
        </Button>

        <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
          {saving ? "Saving…" : "Save Routing"}
        </Button>
      </Box>

      {/* ── Right: help panel ── */}
      <Box sx={{ width: 260, flexShrink: 0, position: "sticky", top: 0 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "#fafafa" }}>
          <Typography fontSize={12} fontWeight={700} color="primary.main" sx={{ mb: 1 }}>
            {helpContent?.title || "Hover any field for help"}
          </Typography>
          {helpContent && (
            <>
              <Typography fontSize={12} color="text.secondary" sx={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>
                {helpContent.body}
              </Typography>
              {helpContent.example && (
                <Box sx={{ mt: 1.5, p: 1.5, bgcolor: "#f0f4ff", borderRadius: 1, borderLeft: "3px solid #6366f1" }}>
                  <Typography fontSize={11} color="#4338ca" sx={{ lineHeight: 1.5 }}>
                    <strong>Example:</strong> {helpContent.example}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </Paper>
      </Box>
    </Box>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function AgentDetail({ agent }: { agent: AgentRecord }) {
  const [tab, setTab] = useState(0)
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [manifest, setManifest] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [saveAlert, setSaveAlert] = useState<{ type: "success" | "error"; msg: string } | null>(null)

  useEffect(() => {
    setTab(0)
    setLoading(true)
    setConfig(null)
    setManifest(null)
    setSaveAlert(null)
    Promise.all([
      getAgentConfig(agent.capability_name, agent.agent_repo_name, agent.agent_type),
      getAgentManifest(agent.capability_name, agent.agent_repo_name, agent.agent_type),
    ])
      .then(([configRes, manifestRes]) => {
        setConfig(configRes.data.config)
        setManifest(manifestRes.data.manifest)
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false))
  }, [agent])

  const handleSave = useCallback(async (section: string, changes: any) => {
    try {
      await patchAgentConfig({
        capability_name: agent.capability_name,
        usecase_name: agent.agent_repo_name,
        agent_type: agent.agent_type,
        section,
        changes,
      })
      setSaveAlert({ type: "success", msg: "Saved. Restart agent to apply changes." })
    } catch {
      setSaveAlert({ type: "error", msg: "Save failed." })
    }
    setTimeout(() => setSaveAlert(null), 5000)
  }, [agent])

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 3, pb: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 0.5 }}>
          <Typography variant="h6" fontWeight={700}>{agent.agent_repo_name}</Typography>
          <StatusBadge status={agent.status} />
          <Tooltip title="Open mini UI — standalone test UI for this agent">
            <Box
              component="a"
              href={`http://localhost:8000/agent-ui/${agent.capability_name}/${agent.agent_repo_name}/${agent.agent_type}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                display: "inline-flex", alignItems: "center", gap: 0.5,
                fontSize: 11, fontWeight: 700, px: 1, py: 0.3,
                borderRadius: 1, border: "1px solid #fde68a",
                bgcolor: "#fefce8", color: "#854d0e",
                textDecoration: "none",
                "&:hover": { bgcolor: "#fef08a", borderColor: "#f59e0b" },
              }}
            >
              ↗ Mini UI
            </Box>
          </Tooltip>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {agent.capability_name} / {agent.agent_type}
        </Typography>
      </Box>

      {saveAlert && (
        <Alert severity={saveAlert.type} sx={{ mx: 3, mt: 2 }} onClose={() => setSaveAlert(null)}>
          {saveAlert.msg}
        </Alert>
      )}

      {/* ── Capability matrix — tabs hidden per agent type ── */}
      {(() => {
        const isSummary = agent.agent_type.includes("summar")
        const ALL_TABS = [
          { label: "Overview",  feature: null,     hidden: false },
          { label: "Tools",     feature: null,     hidden: false },
          { label: "HITL",      feature: "hitl",   hidden: isSummary },
          { label: "Memory",    feature: "memory", hidden: false },
          { label: "RAG",       feature: "rag",    hidden: false },
          { label: "Prompts",   feature: null,     hidden: false },
          { label: "Routing",   feature: null,     hidden: isSummary },
        ]
        const visibleTabs = ALL_TABS.filter(t => !t.hidden)
        // Ensure current tab index is valid after filtering
        const activeLabel = visibleTabs[tab]?.label ?? visibleTabs[0]?.label
        return (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: "1px solid", borderColor: "divider" }}>
              {visibleTabs.map(({ label, feature }, i) => {
                const locked = feature ? (agent.locked_features || []).includes(feature) : false
                return (
                  <Tab
                    key={label}
                    value={i}
                    disabled={locked}
                    label={
                      locked ? (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <LockIcon sx={{ fontSize: 12, color: "#94a3b8" }} />
                          <span>{label}</span>
                        </Box>
                      ) : label
                    }
                    sx={{ fontSize: 13, textTransform: "none", minWidth: 72 }}
                  />
                )
              })}
            </Tabs>

            <Box sx={{ flexGrow: 1, overflow: "auto", px: 3, py: 3 }}>
              {loading && <CircularProgress size={24} />}
              {!loading && !config && <Typography color="text.secondary">Config not available.</Typography>}
              {!loading && config && (
                <>
                  {activeLabel === "Overview"  && <OverviewTab agent={agent} manifest={manifest} config={config} />}
                  {activeLabel === "Tools"     && <ToolsTab config={config} onSave={handleSave} />}
                  {activeLabel === "HITL"      && <HitlTab config={config} onSave={handleSave} />}
                  {activeLabel === "Memory"    && <MemoryTab config={config} onSave={handleSave} />}
                  {activeLabel === "RAG"       && <RagTab config={config} onSave={handleSave} agent={agent} />}
                  {activeLabel === "Prompts"   && <PromptsTab config={config} onSave={handleSave} />}
                  {activeLabel === "Routing"   && <RoutingTab config={config} onSave={handleSave} />}
                </>
              )}
            </Box>
          </>
        )
      })()}
    </Box>
  )
}

// ── Agent list (left sidebar) ─────────────────────────────────────────────────

function AgentList({ agents, selected, onSelect }: {
  agents: AgentRecord[]
  selected: AgentRecord | null
  onSelect: (a: AgentRecord) => void
}) {
  const [openCapabilities, setOpenCapabilities] = useState<Record<string, boolean>>({})

  // Group by capability → agents
  const tree: Record<string, AgentRecord[]> = {}
  for (const a of agents) {
    if (!tree[a.capability_name]) tree[a.capability_name] = []
    tree[a.capability_name].push(a)
  }

  // Auto-open all by default
  useEffect(() => {
    const init: Record<string, boolean> = {}
    for (const cap of Object.keys(tree)) init[cap] = true
    setOpenCapabilities(init)
  }, [agents.length])

  return (
    <Box sx={{ overflow: "auto", height: "100%" }}>
      {Object.entries(tree).map(([cap, capAgents]) => (
        <Box key={cap}>
          <ListItemButton
            onClick={() => setOpenCapabilities(p => ({ ...p, [cap]: !p[cap] }))}
            sx={{ py: 0.75, px: 2 }}
          >
            <ListItemText
              primary={cap}
              primaryTypographyProps={{ fontSize: 12, fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }}
            />
            {openCapabilities[cap] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </ListItemButton>
          <Collapse in={!!openCapabilities[cap]}>
            {capAgents.map(a => {
              const isSelected = selected?.agent_repo_name === a.agent_repo_name && selected?.capability_name === a.capability_name
              return (
                <ListItemButton
                  key={a.agent_repo_name}
                  selected={isSelected}
                  onClick={() => onSelect(a)}
                  sx={{ pl: 3, py: 0.75, "&.Mui-selected": { bgcolor: "primary.50" } }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: a.status === "running" ? "#22c55e" : "#94a3b8", flexShrink: 0 }} />
                    <ListItemText
                      primary={a.agent_repo_name}
                      secondary={a.agent_type}
                      primaryTypographyProps={{ fontSize: 13, fontWeight: isSelected ? 600 : 400 }}
                      secondaryTypographyProps={{ fontSize: 11 }}
                    />
                  </Box>
                </ListItemButton>
              )
            })}
          </Collapse>
        </Box>
      ))}
    </Box>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentRegistry() {
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AgentRecord | null>(null)

  const loadAgents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getAgentStatus()
      setAgents(res.data.agents || [])
      if (!selected && res.data.agents?.length > 0) setSelected(res.data.agents[0])
    } catch {
      setAgents([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAgents() }, [])

  return (
    <Box sx={{ display: "flex", height: "100vh", flexDirection: "column" }}>
      {/* Top bar */}
      <Box sx={{ px: 3, py: 2, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 2, bgcolor: "white" }}>
        <Typography variant="h6" fontWeight={700}>Agent Registry</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Refresh status">
          <IconButton size="small" onClick={loadAgents}><RefreshIcon /></IconButton>
        </Tooltip>
      </Box>

      {loading ? (
        <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}><CircularProgress /></Box>
      ) : agents.length === 0 ? (
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">No agents registered yet. Use Create Agent to scaffold your first agent.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexGrow: 1, overflow: "hidden" }}>
          {/* Left: agent list */}
          <Paper elevation={0} sx={{ width: 260, borderRight: "1px solid", borderColor: "divider", overflow: "auto" }}>
            <AgentList agents={agents} selected={selected} onSelect={setSelected} />
          </Paper>
          {/* Right: detail */}
          <Box sx={{ flexGrow: 1, overflow: "auto", bgcolor: "white" }}>
            {selected ? <AgentDetail agent={selected} /> : (
              <Box sx={{ p: 4 }}><Typography color="text.secondary">Select an agent to view details.</Typography></Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}
