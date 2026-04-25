import { useEffect, useState } from "react"
import {
  Box, Typography, Button, TextField, Select, MenuItem, InputLabel,
  FormControl, Divider, Alert, Slider, Switch, CircularProgress, Chip,
} from "@mui/material"
import CheckCircleIcon from "@mui/icons-material/CheckCircle"
import MemoryIcon from "@mui/icons-material/Memory"
import SearchIcon from "@mui/icons-material/Search"
import SecurityIcon from "@mui/icons-material/Security"
import AccountTreeIcon from "@mui/icons-material/AccountTree"
import StorageIcon from "@mui/icons-material/Storage"
import { createApplication, getFilesystemCapabilities, getGatewayTools, startWorkspace } from "../api/factoryApi"

// ── Types ─────────────────────────────────────────────────────────────────────

type BlockType = "memoryRead" | "ragPre" | "ragPlannerTool" | "hitl" | "memoryWrite"

interface PipelineBlocks {
  memoryRead:     { enabled: boolean; maxTurns: number }
  ragPre:         { enabled: boolean; topK: number; threshold: number; strategy: string; pattern: string; tool: string }
  ragPlannerTool: { enabled: boolean; topK: number; threshold: number; strategy: string; pattern: string; tool: string }
  hitl:           { enabled: boolean; minRisk: string; timeoutMinutes: number }
  memoryWrite:    { enabled: boolean; episodic: boolean; semantic: boolean; summary: boolean }
}

const DEFAULT_BLOCKS: PipelineBlocks = {
  memoryRead:     { enabled: false, maxTurns: 8 },
  ragPre:         { enabled: false, topK: 3, threshold: 0.5, strategy: "semantic", pattern: "naive", tool: "search_kb" },
  ragPlannerTool: { enabled: false, topK: 5, threshold: 0.35, strategy: "semantic", pattern: "naive", tool: "search_kb" },
  hitl:           { enabled: false, minRisk: "high_only", timeoutMinutes: 30 },
  memoryWrite:    { enabled: false, episodic: true, semantic: false, summary: false },
}

const BLOCK_META: Record<BlockType, { label: string; color: string; icon: React.ReactNode; description: string }> = {
  memoryRead:     { label: "Memory Read",      color: "#3b82f6", icon: <MemoryIcon sx={{ fontSize: 15 }} />,   description: "Load conversation history before planning" },
  ragPre:         { label: "RAG Pre-Graph",    color: "#10b981", icon: <SearchIcon sx={{ fontSize: 15 }} />,   description: "Retrieve KB chunks and inject into prompt" },
  ragPlannerTool: { label: "RAG Planner Tool", color: "#059669", icon: <SearchIcon sx={{ fontSize: 15 }} />,   description: "Offer search_kb as a tool the planner can call" },
  hitl:           { label: "HITL Gate",        color: "#f59e0b", icon: <SecurityIcon sx={{ fontSize: 15 }} />, description: "Require human approval before executing write tools" },
  memoryWrite:    { label: "Memory Write",     color: "#6366f1", icon: <StorageIcon sx={{ fontSize: 15 }} />,  description: "Write results to episodic / semantic memory" },
}

// pipeline definition — fixed nodes + slot positions
const PIPELINE: Array<
  | { kind: "fixed"; id: string; label: string; color: string }
  | { kind: "slot";  id: string; blockType: BlockType }
> = [
  { kind: "fixed", id: "request",        label: "Request",   color: "#6b7280" },
  { kind: "slot",  id: "memoryRead",     blockType: "memoryRead" },
  { kind: "slot",  id: "ragPre",         blockType: "ragPre" },
  { kind: "fixed", id: "planner",        label: "Planner",   color: "#4f46e5" },
  { kind: "slot",  id: "ragPlannerTool", blockType: "ragPlannerTool" },
  { kind: "fixed", id: "executor",       label: "Executor",  color: "#4f46e5" },
  { kind: "slot",  id: "hitl",           blockType: "hitl" },
  { kind: "slot",  id: "memoryWrite",    blockType: "memoryWrite" },
  { kind: "fixed", id: "responder",      label: "Responder", color: "#4f46e5" },
  { kind: "fixed", id: "response",       label: "Response",  color: "#6b7280" },
]

// ── Pipeline visual ────────────────────────────────────────────────────────────

function FixedNode({ label, color }: { label: string; color: string }) {
  return (
    <Box sx={{
      px: 3, py: 1.2, borderRadius: 2, background: color, color: "white",
      textAlign: "center", minWidth: 160, boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{label}</Typography>
    </Box>
  )
}

function SlotNode({
  blockType, enabled, isSelected, isDragTarget, onDisable, onSelect, onDragOver, onDrop,
}: {
  blockType: BlockType; enabled: boolean; isSelected: boolean; isDragTarget: boolean
  onDisable: () => void; onSelect: () => void
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void
}) {
  const meta = BLOCK_META[blockType]

  if (!enabled) {
    return (
      <Box
        onDragOver={onDragOver}
        onDrop={onDrop}
        sx={{
          px: 3, py: 1, borderRadius: 2, minWidth: 160, textAlign: "center",
          border: isDragTarget ? `2px dashed ${meta.color}` : "2px dashed #d1d5db",
          background: isDragTarget ? `${meta.color}10` : "#fafafa",
          color: isDragTarget ? meta.color : "#b0b8c4",
          transition: "all 0.15s",
        }}
      >
        <Typography sx={{ fontSize: 12 }}>
          {isDragTarget ? `Drop to add ${meta.label}` : meta.label}
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      onClick={onSelect}
      sx={{
        px: 2, py: 1, borderRadius: 2, minWidth: 160, display: "flex",
        alignItems: "center", gap: 1, justifyContent: "space-between",
        background: meta.color, color: "white", cursor: "pointer",
        boxShadow: isSelected ? `0 0 0 3px ${meta.color}60, 0 2px 6px rgba(0,0,0,0.2)` : "0 1px 3px rgba(0,0,0,0.15)",
        transition: "box-shadow 0.15s",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
        {meta.icon}
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</Typography>
      </Box>
      <Box
        component="span"
        onClick={e => { e.stopPropagation(); onDisable() }}
        sx={{ fontSize: 18, lineHeight: 1, cursor: "pointer", opacity: 0.7, "&:hover": { opacity: 1 } }}
      >×</Box>
    </Box>
  )
}

function Connector() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 0 }}>
      <Box sx={{ width: 2, height: 20, background: "#d1d5db" }} />
      <Box sx={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid #d1d5db" }} />
    </Box>
  )
}

function PipelineCanvas({
  blocks, selected, dragOver,
  onDisable, onSelect, onDragOverSlot, onDropSlot,
}: {
  blocks: PipelineBlocks; selected: BlockType | null; dragOver: BlockType | null
  onDisable: (t: BlockType) => void; onSelect: (t: BlockType) => void
  onDragOverSlot: (t: BlockType) => void; onDropSlot: (e: React.DragEvent, t: BlockType) => void
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 4 }}>
      {PIPELINE.map((step, i) => (
        <Box key={step.id} sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {i > 0 && <Connector />}
          {step.kind === "fixed"
            ? <FixedNode label={step.label} color={step.color} />
            : <SlotNode
                blockType={step.blockType}
                enabled={blocks[step.blockType].enabled}
                isSelected={selected === step.blockType}
                isDragTarget={dragOver === step.blockType}
                onDisable={() => onDisable(step.blockType)}
                onSelect={() => onSelect(step.blockType)}
                onDragOver={e => { e.preventDefault(); onDragOverSlot(step.blockType) }}
                onDrop={e => onDropSlot(e, step.blockType)}
              />
          }
        </Box>
      ))}
    </Box>
  )
}

// ── Config panel ───────────────────────────────────────────────────────────────

function ConfigPanel({ selected, blocks, onChange, gatewayTools }: {
  selected: BlockType | null; blocks: PipelineBlocks
  onChange: (t: BlockType, patch: any) => void; gatewayTools: string[]
}) {
  if (!selected) {
    return (
      <Box sx={{ p: 3, color: "#9ca3af", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 1 }}>
        <AccountTreeIcon sx={{ fontSize: 32, opacity: 0.3 }} />
        <Typography sx={{ fontSize: 13, textAlign: "center" }}>Click a block in the pipeline<br />to configure it</Typography>
      </Box>
    )
  }

  const meta = BLOCK_META[selected]
  const cfg = blocks[selected] as any

  return (
    <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5, borderRadius: 1.5, background: `${meta.color}12` }}>
        <Box sx={{ color: meta.color }}>{meta.icon}</Box>
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: meta.color }}>{meta.label}</Typography>
          <Typography sx={{ fontSize: 11, color: "#6b7280" }}>{meta.description}</Typography>
        </Box>
      </Box>
      <Divider />

      {selected === "memoryRead" && (
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1.5, color: "#374151" }}>
            Max conversation turns to load: <strong>{cfg.maxTurns}</strong>
          </Typography>
          <Slider size="small" min={2} max={20} step={1} value={cfg.maxTurns}
            onChange={(_, v) => onChange("memoryRead", { maxTurns: v })}
            marks valueLabelDisplay="auto"
            sx={{ color: meta.color }} />
          <Typography sx={{ fontSize: 11, color: "#9ca3af", mt: 1 }}>
            Recent turns are injected into the planner's context window before it decides what tool to call.
          </Typography>
        </Box>
      )}

      {selected === "ragPre" && <>
        <Chip label="Dim 1 — Strategy" size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 700, fontSize: 11, alignSelf: "flex-start" }} />
        <FormControl size="small" fullWidth>
          <InputLabel>Strategy</InputLabel>
          <Select label="Strategy" value={cfg.strategy}
            onChange={e => onChange("ragPre", { strategy: e.target.value })}>
            <MenuItem value="semantic">Semantic (vector similarity)</MenuItem>
            <MenuItem value="keyword">Keyword (BM25)</MenuItem>
            <MenuItem value="hybrid">Hybrid (vector + BM25, RRF merge)</MenuItem>
            <MenuItem value="graph" disabled sx={{ color: "#9ca3af" }}>Graph RAG — roadmap</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel>KB tool</InputLabel>
          <Select label="KB tool" value={cfg.tool}
            onChange={e => onChange("ragPre", { tool: e.target.value })}>
            {gatewayTools.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        <Chip label="Dim 2 — Pre-Graph Stage" size="small" sx={{ bgcolor: "#dbeafe", color: "#1d4ed8", fontWeight: 700, fontSize: 11, alignSelf: "flex-start" }} />
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: "#374151" }}>Top K: <strong>{cfg.topK}</strong></Typography>
          <Slider size="small" min={1} max={10} step={1} value={cfg.topK}
            onChange={(_, v) => onChange("ragPre", { topK: v })}
            marks valueLabelDisplay="auto" sx={{ color: meta.color }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: "#374151" }}>Threshold: <strong>{cfg.threshold}</strong></Typography>
          <Slider size="small" min={0} max={1} step={0.05} value={cfg.threshold}
            onChange={(_, v) => onChange("ragPre", { threshold: v })}
            valueLabelDisplay="auto" sx={{ color: meta.color }} />
        </Box>
        <Chip label="Dim 3 — Pattern" size="small" sx={{ bgcolor: "#ede9fe", color: "#5b21b6", fontWeight: 700, fontSize: 11, alignSelf: "flex-start" }} />
        <FormControl size="small" fullWidth>
          <InputLabel>Pattern</InputLabel>
          <Select label="Pattern" value={cfg.pattern || "naive"}
            onChange={e => onChange("ragPre", { pattern: e.target.value })}>
            <MenuItem value="naive">Naive — single retrieve, no retry</MenuItem>
            <MenuItem value="self_corrective">Self-Corrective — re-query if poor</MenuItem>
            <MenuItem value="multi_hop" disabled sx={{ color: "#9ca3af" }}>Multi-Hop — roadmap</MenuItem>
            <MenuItem value="hyde" disabled sx={{ color: "#9ca3af" }}>HyDE — roadmap</MenuItem>
            <MenuItem value="agentic" disabled sx={{ color: "#9ca3af" }}>Agentic — roadmap</MenuItem>
          </Select>
        </FormControl>
      </>}

      {selected === "ragPlannerTool" && <>
        <Chip label="Dim 1 — Strategy" size="small" sx={{ bgcolor: "#dcfce7", color: "#166634", fontWeight: 700, fontSize: 11, alignSelf: "flex-start" }} />
        <FormControl size="small" fullWidth>
          <InputLabel>Strategy</InputLabel>
          <Select label="Strategy" value={cfg.strategy || "semantic"}
            onChange={e => onChange("ragPlannerTool", { strategy: e.target.value })}>
            <MenuItem value="semantic">Semantic (vector similarity)</MenuItem>
            <MenuItem value="keyword">Keyword (BM25)</MenuItem>
            <MenuItem value="hybrid">Hybrid (vector + BM25, RRF merge)</MenuItem>
            <MenuItem value="graph" disabled sx={{ color: "#9ca3af" }}>Graph RAG — roadmap</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel>KB tool</InputLabel>
          <Select label="KB tool" value={cfg.tool || "search_kb"}
            onChange={e => onChange("ragPlannerTool", { tool: e.target.value })}>
            {gatewayTools.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        <Chip label="Dim 2 — Planner Tool Stage" size="small" sx={{ bgcolor: "#dbeafe", color: "#1d4ed8", fontWeight: 700, fontSize: 11, alignSelf: "flex-start" }} />
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: "#374151" }}>Top K: <strong>{cfg.topK}</strong></Typography>
          <Slider size="small" min={1} max={10} step={1} value={cfg.topK || 5}
            onChange={(_, v) => onChange("ragPlannerTool", { topK: v })}
            marks valueLabelDisplay="auto" sx={{ color: meta.color }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: "#374151" }}>Threshold: <strong>{cfg.threshold}</strong></Typography>
          <Slider size="small" min={0} max={1} step={0.05} value={cfg.threshold || 0.35}
            onChange={(_, v) => onChange("ragPlannerTool", { threshold: v })}
            valueLabelDisplay="auto" sx={{ color: meta.color }} />
        </Box>
        <Chip label="Dim 3 — Pattern" size="small" sx={{ bgcolor: "#ede9fe", color: "#5b21b6", fontWeight: 700, fontSize: 11, alignSelf: "flex-start" }} />
        <FormControl size="small" fullWidth>
          <InputLabel>Pattern</InputLabel>
          <Select label="Pattern" value={cfg.pattern || "naive"}
            onChange={e => onChange("ragPlannerTool", { pattern: e.target.value })}>
            <MenuItem value="naive">Naive — single retrieve, no retry</MenuItem>
            <MenuItem value="self_corrective">Self-Corrective — re-query if poor</MenuItem>
            <MenuItem value="multi_hop" disabled sx={{ color: "#9ca3af" }}>Multi-Hop — roadmap</MenuItem>
            <MenuItem value="hyde" disabled sx={{ color: "#9ca3af" }}>HyDE — roadmap</MenuItem>
            <MenuItem value="agentic" disabled sx={{ color: "#9ca3af" }}>Agentic — roadmap</MenuItem>
          </Select>
        </FormControl>
        <Typography sx={{ fontSize: 11, color: "#6b7280", p: 1.5, background: "#f9fafb", borderRadius: 1.5, border: "1px solid #e5e7eb" }}>
          Planner calls this tool explicitly when the user asks a KB question. Retrieval only happens when the planner judges it necessary.
        </Typography>
      </>}

      {selected === "hitl" && <>
        <FormControl size="small" fullWidth>
          <InputLabel>Require approval for</InputLabel>
          <Select label="Require approval for" value={cfg.minRisk}
            onChange={e => onChange("hitl", { minRisk: e.target.value })}>
            <MenuItem value="high_only">High risk tools only</MenuItem>
            <MenuItem value="medium_and_above">Medium + High risk tools</MenuItem>
            <MenuItem value="all">All write tools</MenuItem>
          </Select>
        </FormControl>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: "#374151" }}>
            Approval timeout: <strong>{cfg.timeoutMinutes} min</strong>
          </Typography>
          <Slider size="small" min={5} max={120} step={5} value={cfg.timeoutMinutes}
            onChange={(_, v) => onChange("hitl", { timeoutMinutes: v })}
            valueLabelDisplay="auto" sx={{ color: meta.color }} />
        </Box>
      </>}

      {selected === "memoryWrite" && <>
        <Typography sx={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>What to write after each turn:</Typography>
        {[
          { key: "episodic",  label: "Episodic",  desc: "Clinical events and tool executions" },
          { key: "semantic",  label: "Semantic",  desc: "Long-term facts about the member" },
          { key: "summary",   label: "Summary",   desc: "Periodic conversation summaries" },
        ].map(({ key, label, desc }) => (
          <Box key={key} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", p: 1.5, border: "1px solid #e5e7eb", borderRadius: 1.5 }}>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{label}</Typography>
              <Typography sx={{ fontSize: 11, color: "#9ca3af" }}>{desc}</Typography>
            </Box>
            <Switch size="small" checked={cfg[key]}
              onChange={e => onChange("memoryWrite", { [key]: e.target.checked })}
              sx={{ "& .MuiSwitch-thumb": { background: meta.color } }} />
          </Box>
        ))}
      </>}
    </Box>
  )
}

// ── Palette item ───────────────────────────────────────────────────────────────

function PaletteItem({ blockType, enabled, onToggle }: {
  blockType: BlockType; enabled: boolean; onToggle: () => void
}) {
  const meta = BLOCK_META[blockType]
  return (
    <Box
      draggable={!enabled}
      onClick={onToggle}
      onDragStart={e => { e.dataTransfer.setData("blockType", blockType); e.dataTransfer.effectAllowed = "copy" }}
      sx={{
        display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1,
        borderRadius: 1.5, border: "1px solid",
        borderColor: enabled ? meta.color : "#e5e7eb",
        background: enabled ? `${meta.color}12` : "white",
        color: enabled ? meta.color : "#6b7280",
        cursor: "pointer", userSelect: "none", transition: "all 0.15s",
        "&:hover": { borderColor: meta.color, color: meta.color, background: `${meta.color}08` },
      }}
    >
      {meta.icon}
      <Typography sx={{ fontSize: 12, fontWeight: 500, flexGrow: 1 }}>{meta.label}</Typography>
      {enabled
        ? <CheckCircleIcon sx={{ fontSize: 14 }} />
        : <Typography sx={{ fontSize: 10, color: "#9ca3af" }}>drag / click</Typography>
      }
    </Box>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PipelineBuilder() {
  const [step, setStep] = useState(1)
  const [agentName, setAgentName] = useState("")
  const [agentFolder, setAgentFolder] = useState("")
  const [capability, setCapability] = useState("")
  const [agentType, setAgentType] = useState("chat_agent")
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [blocks, setBlocks] = useState<PipelineBlocks>(DEFAULT_BLOCKS)
  const [selected, setSelected] = useState<BlockType | null>(null)
  const [dragOver, setDragOver] = useState<BlockType | null>(null)
  const [gatewayTools, setGatewayTools] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    getFilesystemCapabilities().then(r => setCapabilities(r.data.capabilities || []))
    getGatewayTools().then(r => setGatewayTools((r.data.tools || []).map((t: any) => t.name)))
  }, [])

  useEffect(() => {
    if (agentName) setAgentFolder(agentName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
  }, [agentName])

  const enableBlock = (type: BlockType) => {
    setBlocks(b => ({ ...b, [type]: { ...b[type], enabled: true } }))
    setSelected(type)
  }

  const disableBlock = (type: BlockType) => {
    setBlocks(b => ({ ...b, [type]: { ...b[type], enabled: false } }))
    setSelected(s => s === type ? null : s)
  }

  const patchBlock = (type: BlockType, patch: any) => {
    setBlocks(b => ({ ...b, [type]: { ...b[type], ...patch } }))
  }

  const handleDrop = (e: React.DragEvent, slotType: BlockType) => {
    e.preventDefault()
    const bt = e.dataTransfer.getData("blockType") as BlockType
    if (bt === slotType && !blocks[bt].enabled) enableBlock(bt)
    setDragOver(null)
  }

  const anyEnabled = Object.values(blocks).some(b => b.enabled)

  const handleCreate = async () => {
    if (!anyEnabled) { setMessage("Enable at least one capability block first."); return }
    setSaving(true); setMessage("")
    try {
      const b = blocks
      const payload = {
        factory_mode: "scaffold_agent",
        app: { repo_name: agentFolder, app_name: agentName },
        agents: [{
          agent_name: agentName, agent_type: agentType, mode: "create_new",
          capabilities: gatewayTools,
          create_config: {
            repo_name: agentFolder, capability_name: capability,
            usecase_name: agentFolder, agent_type: agentType,
            tool_policy: { mode: "all", allowed_tools: [], allowed_tags: [] },
            rag: {
              enabled: b.ragPre.enabled || b.ragPlannerTool.enabled,
              pre_graph: {
                enabled: b.ragPre.enabled,
                tool: b.ragPre.tool,
                strategy: b.ragPre.strategy,
                pattern: b.ragPre.pattern,
                top_k: b.ragPre.topK,
                similarity_threshold: b.ragPre.threshold,
              },
              planner_tool: {
                enabled: b.ragPlannerTool.enabled,
                tool: b.ragPlannerTool.tool,
                strategy: b.ragPlannerTool.strategy,
                pattern: b.ragPlannerTool.pattern,
                top_k: b.ragPlannerTool.topK,
                similarity_threshold: b.ragPlannerTool.threshold,
                fallback: { allow_no_results_response: true },
              },
            },
            risk: { approval_required: b.hitl.enabled },
            hitl: {
              routing_rules:
                b.hitl.minRisk === "all" ? [{ risk_level: "low", requires_approval: true }, { risk_level: "medium", requires_approval: true }, { risk_level: "high", requires_approval: true }]
                : b.hitl.minRisk === "medium_and_above" ? [{ risk_level: "medium", requires_approval: true }, { risk_level: "high", requires_approval: true }]
                : [{ risk_level: "high", requires_approval: true }],
              sla: { timeout_minutes: b.hitl.timeoutMinutes },
            },
            memory: {
              enabled: b.memoryRead.enabled || b.memoryWrite.enabled,
              retrieval_policies: { conversation: { short_term: { max_turns: b.memoryRead.maxTurns } } },
              write_policies: {
                short_term: { enabled: b.memoryRead.enabled },
                episodic: { enabled: b.memoryWrite.enabled && b.memoryWrite.episodic },
                semantic: { enabled: b.memoryWrite.enabled && b.memoryWrite.semantic },
                summary: { enabled: b.memoryWrite.enabled && b.memoryWrite.summary },
              },
            },
            model: { provider: "openai", model: "gpt-4o", temperature: 0.2 },
            embeddings: { provider: "openai", model: "text-embedding-3-small" },
            prompts: {},
          },
        }],
      }
      const res = await createApplication(payload)
      if (!res?.data?.ok) throw new Error(res?.data?.error || "scaffold failed")
      await startWorkspace(agentFolder)
      setMessage(`Agent "${agentName}" created successfully.`)
    } catch (err: any) {
      setMessage(`Error: ${err?.response?.data?.error || err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <Box sx={{ maxWidth: 480, mx: "auto", mt: 8, px: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Pipeline Builder</Typography>
        <Typography sx={{ fontSize: 13, color: "#6b7280", mb: 4 }}>
          Visually assemble your agent's capabilities, then configure each block.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <TextField label="Agent name" size="small" fullWidth value={agentName}
            onChange={e => setAgentName(e.target.value)}
            helperText="e.g. claims-intake, prior-auth-assistant" />
          <FormControl size="small" fullWidth>
            <InputLabel>Capability</InputLabel>
            <Select label="Capability" value={capability} onChange={e => setCapability(e.target.value)}>
              {capabilities.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Agent type</InputLabel>
            <Select label="Agent type" value={agentType} onChange={e => setAgentType(e.target.value)}>
              <MenuItem value="chat_agent">chat_agent — simple (linear planner)</MenuItem>
              <MenuItem value="summarization_agent">summarization_agent</MenuItem>
              <MenuItem disabled value="chat_agent_react" sx={{ color: "#9ca3af" }}>chat_agent — ReAct (think→act→observe) · roadmap</MenuItem>
              <MenuItem disabled value="chat_agent_cot" sx={{ color: "#9ca3af" }}>chat_agent — Chain-of-Thought · roadmap</MenuItem>
              <MenuItem disabled value="chat_agent_self_corrective" sx={{ color: "#9ca3af" }}>chat_agent — Self-Corrective · roadmap</MenuItem>
              <MenuItem disabled value="chat_agent_reflection" sx={{ color: "#9ca3af" }}>chat_agent — Reflection · roadmap</MenuItem>
              <MenuItem disabled value="chat_agent_plan_execute" sx={{ color: "#9ca3af" }}>chat_agent — Plan & Execute · roadmap</MenuItem>
              <MenuItem disabled value="workflow_agent" sx={{ color: "#9ca3af" }}>workflow_agent — simple · roadmap</MenuItem>
              <MenuItem disabled value="workflow_agent_react" sx={{ color: "#9ca3af" }}>workflow_agent — ReAct · roadmap</MenuItem>
              <MenuItem disabled value="multi_agent" sx={{ color: "#9ca3af" }}>multi_agent — supervisor · roadmap</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained" disabled={!agentName || !capability}
            onClick={() => setStep(2)} sx={{ alignSelf: "flex-end", mt: 1 }}>
            Next: Build Pipeline →
          </Button>
        </Box>
      </Box>
    )
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>

      {/* Header */}
      <Box sx={{ px: 3, py: 1.5, borderBottom: "1px solid #e5e7eb", background: "white", display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <Button size="small" onClick={() => setStep(1)} sx={{ color: "#6b7280", fontSize: 12, minWidth: 0 }}>← Back</Button>
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{agentName}</Typography>
          <Typography sx={{ fontSize: 12, color: "#9ca3af" }}>{capability} · {agentType}</Typography>
        </Box>
        <Box sx={{ ml: "auto", display: "flex", gap: 1.5, alignItems: "center" }}>
          {message && (
            <Alert severity={message.startsWith("Error") ? "error" : "success"} sx={{ py: 0, fontSize: 12 }}>
              {message}
            </Alert>
          )}
          <Button variant="contained" size="small" disabled={saving || !anyEnabled} onClick={handleCreate}
            startIcon={saving ? <CircularProgress size={14} /> : <AccountTreeIcon sx={{ fontSize: 16 }} />}>
            {saving ? "Creating…" : "Create Agent"}
          </Button>
        </Box>
      </Box>

      {/* 3-column body */}
      <Box sx={{ display: "flex", flexGrow: 1, overflow: "hidden" }}>

        {/* Left palette */}
        <Box sx={{ width: 210, borderRight: "1px solid #e5e7eb", background: "white", p: 2, display: "flex", flexDirection: "column", gap: 1.5, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.8 }}>
            Capabilities
          </Typography>
          <Typography sx={{ fontSize: 11, color: "#b0b8c4" }}>Click or drag onto pipeline</Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {(Object.keys(BLOCK_META) as BlockType[]).map(bt => (
              <PaletteItem key={bt} blockType={bt} enabled={blocks[bt].enabled}
                onToggle={() => blocks[bt].enabled ? disableBlock(bt) : enableBlock(bt)} />
            ))}
          </Box>
          <Divider sx={{ mt: 1 }} />
          <Typography sx={{ fontSize: 11, color: "#d1d5db" }}>Guardrails — coming soon</Typography>
        </Box>

        {/* Center canvas */}
        <Box
          sx={{ flexGrow: 1, overflow: "auto", background: "#f8fafc" }}
          onDragLeave={() => setDragOver(null)}
        >
          <PipelineCanvas
            blocks={blocks}
            selected={selected}
            dragOver={dragOver}

            onDisable={disableBlock}
            onSelect={setSelected}
            onDragOverSlot={setDragOver}
            onDropSlot={handleDrop}
          />
        </Box>

        {/* Right config */}
        <Box sx={{ width: 280, borderLeft: "1px solid #e5e7eb", background: "white", overflowY: "auto", flexShrink: 0 }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: "1px solid #f3f4f6" }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.8 }}>
              Configuration
            </Typography>
          </Box>
          <ConfigPanel selected={selected} blocks={blocks} onChange={patchBlock} gatewayTools={gatewayTools} />
        </Box>

      </Box>
    </Box>
  )
}
