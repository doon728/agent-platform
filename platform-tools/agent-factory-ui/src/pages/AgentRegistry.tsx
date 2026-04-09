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

function OverviewTab({ agent, manifest }: { agent: AgentRecord; manifest: any }) {
  const dim2 = manifest?.rag_dimension2
  const otherPatterns: Array<{ pattern: string; description: string }> = dim2?.other_patterns || []

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Basic info */}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
        {[
          ["Capability", agent.capability_name],
          ["Agent", agent.agent_repo_name],
          ["Overlay", agent.agent_type],
          ["Runtime URL", agent.runtime_url],
        ].map(([label, val]) => (
          <Box key={label}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="body2" fontWeight={500}>{val || "—"}</Typography>
          </Box>
        ))}
      </Box>

      <Divider />

      {/* Features */}
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>Features</Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {Object.entries(agent.features || {}).map(([k, v]) => (
            <Chip key={k} label={k} size="small" color={v ? "primary" : "default"} variant={v ? "filled" : "outlined"} />
          ))}
        </Box>
      </Box>

      <Divider />

      {/* Dimension 2 — RAG Pipeline Pattern */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>RAG Pipeline Pattern</Typography>
          <Chip label="Dimension 2" size="small" sx={{ bgcolor: "#e0e7ff", color: "#4338ca", fontWeight: 600, fontSize: 11 }} />
          <Chip label="read-only" size="small" variant="outlined" sx={{ fontSize: 11 }} />
        </Box>

        {dim2 ? (
          <>
            {/* Active pattern */}
            <Box sx={{
              p: 2, borderRadius: 1.5, border: "2px solid",
              borderColor: DIM2_COLORS[dim2.pattern] || "#6366f1",
              bgcolor: "#f8f9ff", mb: 2,
            }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                <Chip
                  label={dim2.pattern.replace("_", " ").toUpperCase()}
                  size="small"
                  sx={{ bgcolor: DIM2_COLORS[dim2.pattern] || "#6366f1", color: "white", fontWeight: 700, fontSize: 11 }}
                />
                <Typography variant="caption" color="text.secondary">active in this overlay</Typography>
              </Box>
              <Typography variant="body2">{dim2.description}</Typography>
            </Box>

            {/* Other patterns — educational */}
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Other patterns require a different agent overlay — they cannot be toggled here:
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {otherPatterns.map(p => (
                <Box key={p.pattern} sx={{ display: "flex", gap: 1.5, p: 1.5, borderRadius: 1, bgcolor: "#f9fafb", border: "1px solid #e5e7eb" }}>
                  <Chip
                    label={p.pattern.replace("_", " ")}
                    size="small"
                    sx={{ bgcolor: DIM2_COLORS[p.pattern] || "#94a3b8", color: "white", fontWeight: 600, fontSize: 11, flexShrink: 0 }}
                  />
                  <Typography variant="body2" color="text.secondary">{p.description}</Typography>
                </Box>
              ))}
            </Box>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">No Dimension 2 metadata in manifest.</Typography>
        )}
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

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <FormControl size="small" sx={{ maxWidth: 240 }}>
        <InputLabel>Tool Access Mode</InputLabel>
        <Select value={mode} label="Tool Access Mode" onChange={e => setMode(e.target.value)}>
          <MenuItem value="selected">Selected (allowlist)</MenuItem>
          <MenuItem value="auto">Auto (by tag)</MenuItem>
        </Select>
      </FormControl>

      {mode === "selected" && (
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Allowed Tools</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tool Name</TableCell>
                <TableCell align="right">Remove</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {allowedTools.map((t) => (
                <TableRow key={t}>
                  <TableCell>{t}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setAllowedTools(allowedTools.filter(x => x !== t))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
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

function HitlTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const agentCfg = config.agent || {}
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [riskLevels, setRiskLevels] = useState<Record<string, string>>({})
  const [routingRules, setRoutingRules] = useState<Array<{ risk_level: string; requires_approval: boolean }>>([])
  const [timeoutMinutes, setTimeoutMinutes] = useState(60)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setApprovalRequired(agentCfg?.risk?.approval_required || false)
    setRiskLevels(agentCfg?.risk?.risk_levels || {})
    setRoutingRules(agentCfg?.hitl?.routing_rules || [])
    setTimeoutMinutes(agentCfg?.hitl?.sla?.timeout_minutes || 60)
  }, [config])

  const save = async () => {
    setSaving(true)
    await onSave("agent", {
      risk: { approval_required: approvalRequired, risk_levels: riskLevels },
      hitl: { routing_rules: routingRules, sla: { timeout_minutes: timeoutMinutes } },
    })
    setSaving(false)
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <FormControlLabel
        control={<Switch checked={approvalRequired} onChange={e => setApprovalRequired(e.target.checked)} />}
        label="Approval Required"
      />

      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Risk Levels per Tool</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Tool</TableCell>
              <TableCell>Risk Level</TableCell>
              <TableCell align="right">Remove</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(riskLevels).map(([tool, level]) => (
              <TableRow key={tool}>
                <TableCell>{tool}</TableCell>
                <TableCell>
                  <Select size="small" value={level} onChange={e => setRiskLevels({ ...riskLevels, [tool]: e.target.value })}>
                    {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => {
                    const next = { ...riskLevels }; delete next[tool]; setRiskLevels(next)
                  }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3}>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setRiskLevels({ ...riskLevels, new_tool: "low" })}>
                  Add Tool
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Box>

      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Routing Rules</Typography>
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
                  <Select size="small" value={rule.risk_level} onChange={e => {
                    const next = [...routingRules]; next[i] = { ...next[i], risk_level: e.target.value }; setRoutingRules(next)
                  }}>
                    {RISK_LEVELS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell>
                  <Switch checked={rule.requires_approval} onChange={e => {
                    const next = [...routingRules]; next[i] = { ...next[i], requires_approval: e.target.checked }; setRoutingRules(next)
                  }} />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => setRoutingRules(routingRules.filter((_, j) => j !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3}>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setRoutingRules([...routingRules, { risk_level: "high", requires_approval: true }])}>
                  Add Rule
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Box>

      <TextField
        label="SLA Timeout (minutes)"
        type="number"
        size="small"
        value={timeoutMinutes}
        onChange={e => setTimeoutMinutes(Number(e.target.value))}
        sx={{ maxWidth: 200 }}
      />

      <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save HITL"}
      </Button>
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

  return (
    <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
      {/* ── Left: config cards ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <FormControlLabel
          control={<Switch checked={!!memoryCfg.enabled} onChange={e => setMemoryCfg({ ...memoryCfg, enabled: e.target.checked })} />}
          label={<Typography fontWeight={700}>Memory Enabled</Typography>}
        />

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
                  <FormControlLabel
                    {...help("read")}
                    control={<Switch size="small" checked={rc.enabled !== false} onChange={e => setReadEnabled(key, e.target.checked)} />}
                    label={<Typography fontSize={13}>{rc.enabled !== false ? "Enabled" : "Disabled"}</Typography>}
                  />
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
                    <FormControlLabel
                      {...help("write")}
                      control={<Switch size="small" checked={!!wc.enabled} onChange={e => setWriteField(key, "enabled", e.target.checked)} />}
                      label={<Typography fontSize={13}>{wc.enabled ? "Enabled" : "Disabled"}</Typography>}
                    />
                  )}

                  {!locked && (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 2 }}>
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

                      <TextField
                        {...help("max_content_tokens")}
                        size="small" label="Max content tokens" type="number" fullWidth
                        value={wc.max_content_tokens || ""} placeholder="unlimited"
                        onChange={e => setWriteField(key, "max_content_tokens", e.target.value ? Number(e.target.value) : undefined)}
                      />

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

                      {/* Type-specific write controls */}
                      {key === "short_term" && (
                        <>
                          <TextField
                            {...help("retain_last_n_turns")}
                            size="small" label="Retain last N turns" type="number" fullWidth
                            value={wc.retain_last_n_turns || ""} placeholder="e.g. 12"
                            onChange={e => setWriteField(key, "retain_last_n_turns", e.target.value ? Number(e.target.value) : undefined)}
                          />
                          <Tooltip title={supportsIntermediate ? "" : `Not applicable — current strategy is '${reasoningStrategy}'. Enable ReAct or multi-hop to use this.`}>
                            <span>
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
                            </span>
                          </Tooltip>
                        </>
                      )}

                      {key === "episodic" && (
                        <>
                          <FormControlLabel
                            {...help("write_on_tool_call")}
                            control={<Switch size="small" checked={!!wc.write_on_tool_call?.enabled} onChange={e => setNestedWriteField(key, "write_on_tool_call", "enabled", e.target.checked)} />}
                            label={<Typography fontSize={13}>Write on tool call</Typography>}
                          />
                          <FormControl size="small" fullWidth disabled={!wc.write_on_tool_call?.enabled} {...help("tools_trigger")}>
                            <InputLabel>Tools that trigger write</InputLabel>
                            <Select value={wc.write_on_tool_call?.tools || "write_only"} label="Tools that trigger write"
                              onChange={e => setNestedWriteField(key, "write_on_tool_call", "tools", e.target.value)}>
                              <MenuItem value="write_only">Write tools only</MenuItem>
                              <MenuItem value="all">All tools</MenuItem>
                            </Select>
                          </FormControl>
                        </>
                      )}

                      {key === "semantic" && (
                        <FormControlLabel
                          {...help("dedup")}
                          control={<Switch size="small" checked={!!wc.dedup?.enabled} onChange={e => setNestedWriteField(key, "dedup", "enabled", e.target.checked)} />}
                          label={<Typography fontSize={13}>Deduplication</Typography>}
                        />
                      )}

                      {key === "summary" && (
                        <>
                          <FormControl size="small" fullWidth {...help("summary_trigger")}>
                            <InputLabel>Write trigger</InputLabel>
                            <Select value={wc.trigger || "explicit"} label="Write trigger" onChange={e => setWriteField(key, "trigger", e.target.value)}>
                              {SUMMARY_TRIGGERS.map(t => <MenuItem key={t} value={t}>{SUMMARY_TRIGGER_LABELS[t]}</MenuItem>)}
                            </Select>
                          </FormControl>
                          {wc.trigger === "turn_count" && (
                            <TextField {...help("turn_count_threshold")} size="small" label="Turn threshold" type="number" fullWidth
                              value={wc.turn_count_threshold || 20} onChange={e => setWriteField(key, "turn_count_threshold", Number(e.target.value))} />
                          )}
                          {wc.trigger === "token_threshold" && (
                            <TextField {...help("token_threshold")} size="small" label="Token threshold" type="number" fullWidth
                              value={wc.token_threshold || 8000} onChange={e => setWriteField(key, "token_threshold", Number(e.target.value))} />
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

function RagTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void>; agent: AgentRecord }) {
  const [retrieval, setRetrieval] = useState<any>({})
  const [gatewayTools, setGatewayTools] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRetrieval(config.agent?.retrieval || {})
  }, [config])

  useEffect(() => {
    getGatewayTools().then(res => setGatewayTools(res.data?.tools || [])).catch(() => {})
  }, [])

  // Tools from gateway that are tagged "retrieval"
  const retrievalTools = gatewayTools.filter(t => t.tags?.includes("retrieval"))
  // Tools currently assigned to this agent for retrieval
  const allowedTools: string[] = config.agent?.tools?.allowed || []
  const assignedRetrievalTools = retrievalTools.filter(t => allowedTools.includes(t.name))
  // Active strategy from config
  const activeStrategy = retrieval.strategy || "semantic"
  void DIM1_ALL_STRATEGIES.find(s => s.value === activeStrategy) // active strategy reference

  const save = async () => {
    setSaving(true)
    await onSave("agent", { retrieval })
    setSaving(false)
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <FormControlLabel
        control={<Switch checked={!!retrieval.enabled} onChange={e => setRetrieval({ ...retrieval, enabled: e.target.checked })} />}
        label="RAG Enabled"
      />

      {/* Dimension 1 — Strategy */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <Typography variant="body2" fontWeight={700}>Dimension 1 — Search Strategy</Typography>
          <Chip label="Dim 1" size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          How documents are retrieved from the KB. All three strategies are supported today (semantic via pgvector, keyword via PostgreSQL full-text, hybrid via RRF merge).
        </Typography>
        <FormControl size="small" sx={{ minWidth: 280, mb: 2 }}>
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <Typography variant="body2" fontWeight={700}>Dimension 3 — Retrieval Pattern</Typography>
          <Chip label="Dim 3" size="small" sx={{ bgcolor: "#ede9fe", color: "#5b21b6", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          Controls the retrieval loop behavior — how many times to retrieve and whether to self-evaluate results.
        </Typography>
        <FormControl size="small" sx={{ minWidth: 280 }}>
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
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Typography variant="body2" fontWeight={700}>Pre-Graph RAG</Typography>
          <Chip label="Dim 2 — Stage 1" size="small" sx={{ bgcolor: "#ede9fe", color: "#5b21b6", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          Retrieves KB chunks BEFORE the planner runs. Injected silently into context — no tool call needed. Best for: chat_agent, workflow_agent. Not for: react_agent.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <FormControlLabel
            control={<Switch checked={!!retrieval.pre_graph?.enabled}
              onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, enabled: e.target.checked } })} />}
            label="Enabled"
          />
          {retrieval.pre_graph?.enabled && <>
            <FormControl size="small" sx={{ maxWidth: 280 }}>
              <InputLabel>KB Tool</InputLabel>
              <Select value={retrieval.pre_graph?.tool || "search_kb"} label="KB Tool"
                onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, tool: e.target.value } })}>
                {assignedRetrievalTools.length > 0
                  ? assignedRetrievalTools.map(t => <MenuItem key={t.name} value={t.name}>{t.name}</MenuItem>)
                  : <MenuItem value="search_kb">search_kb</MenuItem>}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ maxWidth: 280 }}>
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
            <FormControl size="small" sx={{ maxWidth: 280 }}>
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
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField size="small" label="Top K" type="number" sx={{ maxWidth: 120 }}
                value={retrieval.pre_graph?.top_k ?? 3}
                onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, top_k: Number(e.target.value) } })}
                helperText="Keep low (2–4)" />
              <TextField size="small" label="Threshold" type="number" inputProps={{ step: 0.05, min: 0, max: 1 }} sx={{ maxWidth: 140 }}
                value={retrieval.pre_graph?.similarity_threshold ?? 0.5}
                onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, similarity_threshold: Number(e.target.value) } })}
                helperText="Higher = more selective" />
            </Box>
          </>}
        </Box>
      </Box>

      <Divider />

      {/* Planner tool RAG — fully independent config */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          <Typography variant="body2" fontWeight={700}>Planner Tool RAG</Typography>
          <Chip label="Dim 2 — Stage 2" size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          Exposes search_kb as a tool the planner LLM calls explicitly when the user asks a KB question. Best for: chat_agent, react_agent. Not for: summary_agent.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <FormControlLabel
            control={<Switch checked={!!retrieval.planner_tool?.enabled}
              onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, enabled: e.target.checked } })} />}
            label="Enabled"
          />
          {retrieval.planner_tool?.enabled && <>
            <FormControl size="small" sx={{ maxWidth: 280 }}>
              <InputLabel>KB Tool</InputLabel>
              <Select value={retrieval.planner_tool?.tool || "search_kb"} label="KB Tool"
                onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, tool: e.target.value } })}>
                {assignedRetrievalTools.length > 0
                  ? assignedRetrievalTools.map(t => <MenuItem key={t.name} value={t.name}>{t.name}</MenuItem>)
                  : <MenuItem value="search_kb">search_kb</MenuItem>}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ maxWidth: 280 }}>
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
            <FormControl size="small" sx={{ maxWidth: 280 }}>
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
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField size="small" label="Top K" type="number" sx={{ maxWidth: 120 }}
                value={retrieval.planner_tool?.top_k ?? 5}
                onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, top_k: Number(e.target.value) } })} />
              <TextField size="small" label="Threshold" type="number" inputProps={{ step: 0.05, min: 0, max: 1 }} sx={{ maxWidth: 140 }}
                value={retrieval.planner_tool?.similarity_threshold ?? 0.35}
                onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, similarity_threshold: Number(e.target.value) } })} />
            </Box>
            <FormControlLabel
              control={<Switch checked={!!retrieval.planner_tool?.fallback?.allow_no_results_response}
                onChange={e => setRetrieval({ ...retrieval, planner_tool: { ...retrieval.planner_tool, fallback: { allow_no_results_response: e.target.checked } } })} />}
              label="Allow No-Results Response"
            />
          </>}
        </Box>
      </Box>

      <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save RAG"}
      </Button>
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

function RoutingTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const agentCfg = config.agent || {}
  type HardRoute = { phrases: string[]; scope: string; tool: string; argument_template?: string }
  const [routes, setRoutes] = useState<HardRoute[]>([])
  const [gatewayTools, setGatewayTools] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRoutes(agentCfg?.hard_routes || [])
  }, [config])

  useEffect(() => {
    getGatewayTools().then(res => setGatewayTools((res.data?.tools || []).map((t: any) => t.name))).catch(() => {})
  }, [])

  const updateRoute = (i: number, field: keyof HardRoute, value: any) => {
    const next = [...routes]
    next[i] = { ...next[i], [field]: value }
    setRoutes(next)
  }

  const addRoute = () => setRoutes([...routes, { phrases: [], scope: "", tool: "", argument_template: "{scope_id}" }])
  const removeRoute = (i: number) => setRoutes(routes.filter((_, j) => j !== i))

  const save = async () => {
    setSaving(true)
    await onSave("agent", { hard_routes: routes })
    setSaving(false)
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        Hard routes fire before the LLM — deterministic phrase matching → tool call. No LLM cost for matched queries.
      </Typography>

      {routes.map((route, i) => (
        <Box key={i} sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="body2" fontWeight={600}>Route {i + 1}</Typography>
            <IconButton size="small" onClick={() => removeRoute(i)}><DeleteIcon fontSize="small" /></IconButton>
          </Box>

          <TextField
            size="small"
            label="Phrases (comma-separated)"
            fullWidth
            value={(route.phrases || []).join(", ")}
            onChange={e => updateRoute(i, "phrases", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
            helperText="If any phrase is found in the user message, this route fires"
          />

          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1.5 }}>
            <TextField
              size="small"
              label="Scope"
              value={route.scope}
              onChange={e => updateRoute(i, "scope", e.target.value)}
              helperText="e.g. assessment, case, member"
            />
            <FormControl size="small">
              <InputLabel>Tool</InputLabel>
              <Select value={route.tool} label="Tool" onChange={e => updateRoute(i, "tool", e.target.value)}>
                {gatewayTools.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Argument template"
              value={route.argument_template || "{scope_id}"}
              onChange={e => updateRoute(i, "argument_template", e.target.value)}
              helperText="{scope_id} = active scope ID, {prompt} = user message"
            />
          </Box>
        </Box>
      ))}

      <Button size="small" startIcon={<AddIcon />} onClick={addRoute} sx={{ alignSelf: "flex-start" }}>
        Add Route
      </Button>

      <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save Routing"}
      </Button>
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

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: "1px solid", borderColor: "divider" }}>
        {[
          { label: "Overview", feature: null },
          { label: "Tools", feature: null },
          { label: "HITL", feature: "hitl" },
          { label: "Memory", feature: "memory" },
          { label: "RAG", feature: "rag" },
          { label: "Prompts", feature: null },
          { label: "Routing", feature: null },
        ].map(({ label, feature }, i) => {
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
            {tab === 0 && <OverviewTab agent={agent} manifest={manifest} />}
            {tab === 1 && <ToolsTab config={config} onSave={handleSave} />}
            {tab === 2 && <HitlTab config={config} onSave={handleSave} />}
            {tab === 3 && <MemoryTab config={config} onSave={handleSave} />}
            {tab === 4 && <RagTab config={config} onSave={handleSave} agent={agent} />}
            {tab === 5 && <PromptsTab config={config} onSave={handleSave} />}
            {tab === 6 && <RoutingTab config={config} onSave={handleSave} />}
          </>
        )}
      </Box>
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
