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
          ["Usecase", agent.usecase_name],
          ["Agent Type", agent.agent_type],
          ["Agent Repo", agent.agent_repo_name],
          ["App Repo", agent.app_repo_name],
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

function MemoryTab({ config, onSave }: { config: AgentConfig; onSave: (section: string, changes: any) => Promise<void> }) {
  const [memoryCfg, setMemoryCfg] = useState<any>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { setMemoryCfg(config.memory || {}) }, [config])

  const setWriteEnabled = (type: string, val: boolean) => {
    setMemoryCfg((prev: any) => ({
      ...prev,
      write_policies: { ...prev.write_policies, [type]: { ...prev.write_policies?.[type], enabled: val } },
    }))
  }

  const save = async () => {
    setSaving(true)
    await onSave("memory", memoryCfg)
    setSaving(false)
  }

  const types = ["short_term", "episodic", "semantic", "summary"]

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <FormControlLabel
        control={<Switch checked={!!memoryCfg.enabled} onChange={e => setMemoryCfg({ ...memoryCfg, enabled: e.target.checked })} />}
        label="Memory Enabled"
      />

      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Write Policies</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Memory Type</TableCell>
              <TableCell>Enabled</TableCell>
              <TableCell>Trigger</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {types.map(type => {
              const policy = memoryCfg?.write_policies?.[type] || {}
              return (
                <TableRow key={type}>
                  <TableCell sx={{ fontWeight: 500 }}>{type.replace("_", " ")}</TableCell>
                  <TableCell>
                    <Switch size="small" checked={!!policy.enabled} onChange={e => setWriteEnabled(type, e.target.checked)} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {Array.isArray(policy.triggers) ? policy.triggers.join(", ") : (policy.trigger || "—")}
                    </Typography>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>

      <Button variant="contained" size="small" onClick={save} disabled={saving} sx={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save Memory"}
      </Button>
    </Box>
  )
}

const DIM1_ALL_STRATEGIES = [
  { value: "semantic", label: "Semantic / Vector", db_type: "vector_db", db_label: "Vector DB", description: "Search by meaning using embeddings. Requires a vector DB (pgvector, Pinecone, Weaviate)." },
  { value: "hybrid", label: "Hybrid (Vector + BM25)", db_type: "hybrid", db_label: "Vector DB + Keyword index", description: "Combines dense vector search with sparse keyword matching. Best of both worlds." },
  { value: "keyword", label: "Keyword (BM25)", db_type: "search_engine", db_label: "Elasticsearch / OpenSearch", description: "Exact and fuzzy word matching. Fast for exact lookups." },
  { value: "graph", label: "Graph RAG", db_type: "graph_db", db_label: "Graph DB (Neo4j)", description: "Traverses entity relationships to find connected nodes. Good for relationship questions." },
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
  const activeDim1 = DIM1_ALL_STRATEGIES.find(s => s.value === activeStrategy)

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

      {/* Dimension 1 — active KB/strategy */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <Typography variant="body2" fontWeight={700}>Knowledge Bases (Dimension 1 — Search Method)</Typography>
          <Chip label="Dimension 1" size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: 11 }} />
        </Box>

        {assignedRetrievalTools.length > 0 ? (
          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Tool (KB)</TableCell>
                <TableCell>DB Type</TableCell>
                <TableCell>Strategy</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignedRetrievalTools.map(t => (
                <TableRow key={t.name}>
                  <TableCell sx={{ fontWeight: 500 }}>{t.name}</TableCell>
                  <TableCell>
                    <Chip label={t.db_type || "—"} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip label={t.strategy || "—"} size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600 }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No retrieval tools assigned. Add a retrieval tool in the Tools tab.
          </Typography>
        )}

        {/* Education: what the active strategy means */}
        {activeDim1 && (
          <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: "#f0fdf4", border: "1px solid #bbf7d0", mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>Active strategy: {activeDim1.label}</Typography>
            <Typography variant="body2">{activeDim1.description}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              Requires: {activeDim1.db_label}
            </Typography>
          </Box>
        )}

        {/* Education: other strategies */}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Strategy is determined by your KB type — other strategies require a different database:
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {DIM1_ALL_STRATEGIES.filter(s => s.value !== activeStrategy).map(s => (
            <Box key={s.value} sx={{ display: "flex", gap: 1.5, p: 1.25, borderRadius: 1, bgcolor: "#f9fafb", border: "1px solid #e5e7eb" }}>
              <Chip label={s.label} size="small" variant="outlined" sx={{ flexShrink: 0, fontSize: 11 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                <Typography variant="caption" sx={{ display: "block", color: "#6b7280" }}>Requires: {s.db_label}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      <Divider />

      {/* Pre-graph RAG */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>Pre-Graph RAG</Typography>
          <Chip label="Ambient Enrichment" size="small" sx={{ bgcolor: "#ede9fe", color: "#5b21b6", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          Retrieves KB chunks before the planner runs and injects them into context. The planner and responder both see this silently — no explicit tool call needed.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <FormControlLabel
            control={<Switch checked={!!retrieval.pre_graph?.enabled}
              onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, enabled: e.target.checked } })} />}
            label="Pre-Graph RAG Enabled"
          />
          <TextField size="small" label="Top K" type="number"
            value={retrieval.pre_graph?.top_k ?? 3}
            onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, top_k: Number(e.target.value) } })}
            sx={{ maxWidth: 160 }} helperText="Chunks to inject (keep low — ambient context only)" />
          <TextField size="small" label="Similarity Threshold" type="number" inputProps={{ step: 0.05, min: 0, max: 1 }}
            value={retrieval.pre_graph?.similarity_threshold ?? 0.5}
            onChange={e => setRetrieval({ ...retrieval, pre_graph: { ...retrieval.pre_graph, similarity_threshold: Number(e.target.value) } })}
            sx={{ maxWidth: 200 }} helperText="Higher threshold — only inject if highly relevant" />
        </Box>
      </Box>

      <Divider />

      {/* Planner tool RAG */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Typography variant="body2" fontWeight={700}>Planner Tool RAG</Typography>
          <Chip label="Explicit Query" size="small" sx={{ bgcolor: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: 11 }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          Planner calls the retrieval tool explicitly when the user asks a KB question (e.g. "what is the protocol for X"). This is the primary response for that turn.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField size="small" label="Default Tool" value={retrieval.default_tool || ""} onChange={e => setRetrieval({ ...retrieval, default_tool: e.target.value })} sx={{ maxWidth: 240 }}
            helperText="Which tool to call for retrieval" />
          <TextField size="small" label="Top K" type="number" value={retrieval.top_k ?? 5} onChange={e => setRetrieval({ ...retrieval, top_k: Number(e.target.value) })} sx={{ maxWidth: 160 }}
            helperText="Number of results to retrieve" />
          <TextField size="small" label="Similarity Threshold" type="number" inputProps={{ step: 0.05, min: 0, max: 1 }}
            value={retrieval.similarity_threshold ?? 0.35} onChange={e => setRetrieval({ ...retrieval, similarity_threshold: Number(e.target.value) })} sx={{ maxWidth: 200 }}
            helperText="Minimum similarity score (0–1)" />
          <FormControlLabel
            control={<Switch checked={!!retrieval.fallback?.allow_no_results_response} onChange={e => setRetrieval({ ...retrieval, fallback: { ...retrieval.fallback, allow_no_results_response: e.target.checked } })} />}
            label="Allow No-Results Response"
          />
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
      getAgentConfig(agent.capability_name, agent.usecase_name, agent.agent_type),
      getAgentManifest(agent.capability_name, agent.usecase_name, agent.agent_type),
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
        usecase_name: agent.usecase_name,
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
          <Typography variant="h6" fontWeight={700}>{agent.agent_type}</Typography>
          <StatusBadge status={agent.status} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {agent.capability_name} / {agent.usecase_name}
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

  // Group by capability → usecase
  const tree: Record<string, Record<string, AgentRecord[]>> = {}
  for (const a of agents) {
    if (!tree[a.capability_name]) tree[a.capability_name] = {}
    if (!tree[a.capability_name][a.usecase_name]) tree[a.capability_name][a.usecase_name] = []
    tree[a.capability_name][a.usecase_name].push(a)
  }

  // Auto-open all by default
  useEffect(() => {
    const init: Record<string, boolean> = {}
    for (const cap of Object.keys(tree)) init[cap] = true
    setOpenCapabilities(init)
  }, [agents.length])

  return (
    <Box sx={{ overflow: "auto", height: "100%" }}>
      {Object.entries(tree).map(([cap, usecases]) => (
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
            {Object.entries(usecases).map(([uc, ucAgents]) => (
              <Box key={uc}>
                <Typography variant="caption" sx={{ pl: 3, py: 0.5, display: "block", color: "text.secondary" }}>{uc}</Typography>
                {ucAgents.map(a => {
                  const isSelected = selected?.agent_type === a.agent_type && selected?.usecase_name === a.usecase_name && selected?.capability_name === a.capability_name
                  return (
                    <ListItemButton
                      key={a.agent_type}
                      selected={isSelected}
                      onClick={() => onSelect(a)}
                      sx={{ pl: 4, py: 0.75, "&.Mui-selected": { bgcolor: "primary.50" } }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: a.status === "running" ? "#22c55e" : "#94a3b8", flexShrink: 0 }} />
                        <ListItemText
                          primary={a.agent_type}
                          primaryTypographyProps={{ fontSize: 13, fontWeight: isSelected ? 600 : 400 }}
                        />
                      </Box>
                    </ListItemButton>
                  )
                })}
              </Box>
            ))}
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
