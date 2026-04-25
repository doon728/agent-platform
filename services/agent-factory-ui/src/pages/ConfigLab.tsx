import { useEffect, useRef, useState } from "react"
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, MenuItem, Select, Stack, Tab, Tabs, TextField,
  Typography, Paper, CircularProgress,
} from "@mui/material"
import AddIcon from "@mui/icons-material/Add"
import DeleteIcon from "@mui/icons-material/Delete"
import PlayArrowIcon from "@mui/icons-material/PlayArrow"
import EditIcon from "@mui/icons-material/Edit"
import CheckCircleIcon from "@mui/icons-material/CheckCircle"
import CancelIcon from "@mui/icons-material/Cancel"

const SUPPORT_API = "http://localhost:8000"
const AGENT_RUNTIME = "http://localhost:8001"

const AGENT = { capability: "care-management", usecase: "pre-call-assessment", type: "chat_agent_simple" }
const CONFIG_FILES = ["agent.yaml", "prompt-defaults.yaml", "memory.yaml"]

// ── Types ─────────────────────────────────────────────────────────────────────
interface Scenario {
  id: string
  name: string
  prompt: string
  member_id?: string
  assessment_id?: string
  case_id?: string
  expected_tool?: string
}

interface ScenarioResult {
  scenario_id: string
  scenario_name: string
  prompt: string
  tool_called: string
  route_type: string
  answer_snippet: string
  latency_ms: number
  pass: boolean | null
  error?: string
}

interface TestRun {
  run_id: string
  ts: string
  config_snapshot: string   // short summary of key config values
  results: ScenarioResult[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(16) + Math.random().toString(16).slice(2) }

function loadScenarios(): Scenario[] {
  try { return JSON.parse(localStorage.getItem("config-lab:scenarios") || "[]") } catch { return [] }
}
function saveScenarios(s: Scenario[]) {
  localStorage.setItem("config-lab:scenarios", JSON.stringify(s))
}
function loadRuns(): TestRun[] {
  try { return JSON.parse(localStorage.getItem("config-lab:runs") || "[]") } catch { return [] }
}
function saveRuns(runs: TestRun[]) {
  localStorage.setItem("config-lab:runs", JSON.stringify(runs))
}

// ── Config Editor Modal ───────────────────────────────────────────────────────
function ConfigEditorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState(0)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState("")

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all(CONFIG_FILES.map(f =>
      fetch(`${SUPPORT_API}/config-lab/file?capability_name=${AGENT.capability}&usecase_name=${AGENT.usecase}&agent_type=${AGENT.type}&filename=${f}`)
        .then(r => r.json())
        .then(d => [f, d.content || ""] as [string, string])
        .catch(() => [f, "# could not load"] as [string, string])
    )).then(pairs => {
      setContents(Object.fromEntries(pairs))
      setLoading(false)
    })
  }, [open])

  async function save() {
    const filename = CONFIG_FILES[tab]
    setSaving(true)
    setSaveMsg("")
    try {
      const res = await fetch(`${SUPPORT_API}/config-lab/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability_name: AGENT.capability,
          usecase_name: AGENT.usecase,
          agent_type: AGENT.type,
          filename,
          content: contents[filename] || "",
        }),
      })
      const d = await res.json()
      setSaveMsg(d.ok ? `Saved · ${d.restart}` : `Error: ${d.detail}`)
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`)
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        Edit Config Files
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 0.5 }}>
          {AGENT.capability} / {AGENT.usecase} / {AGENT.type}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1.5, borderBottom: 1, borderColor: "divider" }}>
          {CONFIG_FILES.map(f => <Tab key={f} label={f} sx={{ fontSize: 12, textTransform: "none" }} />)}
        </Tabs>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={24} /></Box>
        ) : (
          <textarea
            value={contents[CONFIG_FILES[tab]] || ""}
            onChange={e => setContents(prev => ({ ...prev, [CONFIG_FILES[tab]]: e.target.value }))}
            style={{
              width: "100%", height: 420, fontFamily: "monospace", fontSize: 12,
              padding: 12, border: "1px solid #e0e0e0", borderRadius: 6,
              resize: "vertical", outline: "none", lineHeight: 1.6,
              boxSizing: "border-box",
            }}
          />
        )}
        {saveMsg && (
          <Typography variant="caption" sx={{ mt: 1, display: "block", color: saveMsg.startsWith("Error") ? "error.main" : "success.main" }}>
            {saveMsg}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} size="small">Close</Button>
        <Button onClick={save} variant="contained" size="small" disabled={saving}>
          {saving ? "Saving…" : "Save & Apply"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Scenario Row ──────────────────────────────────────────────────────────────
function ScenarioRow({
  scenario, onDelete, onRun, running,
}: {
  scenario: Scenario
  onDelete: () => void
  onRun: () => void
  running: boolean
}) {
  return (
    <Box sx={{
      p: 1.5, mb: 1, borderRadius: 1.5, border: "1px solid #e0e0e0",
      background: "#fafafa", display: "flex", alignItems: "center", gap: 1,
    }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#1a237e" }}>{scenario.name}</Typography>
        <Typography sx={{ fontSize: 11, color: "#757575", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {scenario.prompt}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
          {scenario.member_id && <Chip label={`member: ${scenario.member_id}`} size="small" sx={{ fontSize: 10, height: 18 }} />}
          {scenario.assessment_id && <Chip label={`assess: ${scenario.assessment_id}`} size="small" sx={{ fontSize: 10, height: 18 }} />}
          {scenario.expected_tool && <Chip label={`expect: ${scenario.expected_tool}`} size="small" color="primary" sx={{ fontSize: 10, height: 18 }} />}
        </Stack>
      </Box>
      <IconButton size="small" onClick={onRun} disabled={running} sx={{ color: "#1a237e" }}>
        {running ? <CircularProgress size={16} /> : <PlayArrowIcon fontSize="small" />}
      </IconButton>
      <IconButton size="small" onClick={onDelete} sx={{ color: "#bdbdbd" }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

// ── Add Scenario Dialog ───────────────────────────────────────────────────────
function AddScenarioDialog({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: (s: Scenario) => void
}) {
  const [form, setForm] = useState({ name: "", prompt: "", member_id: "", assessment_id: "", case_id: "", expected_tool: "" })
  function f(k: string) { return (e: any) => setForm(p => ({ ...p, [k]: e.target.value })) }

  function save() {
    if (!form.name || !form.prompt) return
    onSave({
      id: uid(),
      name: form.name,
      prompt: form.prompt,
      member_id: form.member_id || undefined,
      assessment_id: form.assessment_id || undefined,
      case_id: form.case_id || undefined,
      expected_tool: form.expected_tool || undefined,
    })
    setForm({ name: "", prompt: "", member_id: "", assessment_id: "", case_id: "", expected_tool: "" })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Test Scenario</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField label="Name" value={form.name} onChange={f("name")} size="small" fullWidth required />
          <TextField label="Prompt" value={form.prompt} onChange={f("prompt")} size="small" fullWidth required multiline rows={2} />
          <Stack direction="row" spacing={1}>
            <TextField label="member_id" value={form.member_id} onChange={f("member_id")} size="small" fullWidth />
            <TextField label="assessment_id" value={form.assessment_id} onChange={f("assessment_id")} size="small" fullWidth />
            <TextField label="case_id" value={form.case_id} onChange={f("case_id")} size="small" fullWidth />
          </Stack>
          <TextField label="expected_tool (optional)" value={form.expected_tool} onChange={f("expected_tool")} size="small" fullWidth
            helperText="e.g. get_member, search_kb — used for pass/fail check" />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button onClick={save} variant="contained" size="small" disabled={!form.name || !form.prompt}>Add</Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Run a single scenario ─────────────────────────────────────────────────────
async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const t0 = Date.now()
  try {
    const body: any = {
      prompt: scenario.prompt, tenant_id: "t1", user_id: "nurse-1",
      thread_id: `lab-${uid()}`,
    }
    if (scenario.member_id) body.member_id = scenario.member_id
    if (scenario.assessment_id) body.assessment_id = scenario.assessment_id
    if (scenario.case_id) body.case_id = scenario.case_id

    const res = await fetch(`${AGENT_RUNTIME}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const d = await res.json()
    const latency = Date.now() - t0
    const trace = d.memory_trace || {}
    const tool_called = trace.planner?.tool || trace.executor?.tool || (d.ok ? "direct_answer" : "error")
    const route_type = trace.planner?.route_type || "—"
    const pass = scenario.expected_tool
      ? tool_called === scenario.expected_tool
      : d.ok ? true : false

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      prompt: scenario.prompt,
      tool_called,
      route_type,
      answer_snippet: String(d.answer || "").slice(0, 120),
      latency_ms: latency,
      pass,
    }
  } catch (e: any) {
    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      prompt: scenario.prompt,
      tool_called: "error",
      route_type: "—",
      answer_snippet: "",
      latency_ms: Date.now() - t0,
      pass: false,
      error: e.message,
    }
  }
}

// ── Results Table ─────────────────────────────────────────────────────────────
function ResultsTable({ results }: { results: ScenarioResult[] }) {
  const cols = ["Scenario", "Tool Called", "Route", "ms", "✓/✗", "Answer"]
  return (
    <Box sx={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>{cols.map(c => (
            <th key={c} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "2px solid #e0e0e0", color: "#757575", fontWeight: 600, fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap" }}>{c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fafafa" : "white" }}>
              <td style={{ padding: "6px 10px", fontWeight: 600, color: "#1a237e" }}>{r.scenario_name}</td>
              <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#5c6bc0" }}>{r.tool_called}</td>
              <td style={{ padding: "6px 10px", color: "#757575" }}>{r.route_type}</td>
              <td style={{ padding: "6px 10px", color: "#757575" }}>{r.latency_ms}</td>
              <td style={{ padding: "6px 10px" }}>
                {r.pass === true && <CheckCircleIcon sx={{ fontSize: 16, color: "success.main" }} />}
                {r.pass === false && <CancelIcon sx={{ fontSize: 16, color: "error.main" }} />}
                {r.pass === null && "—"}
              </td>
              <td style={{ padding: "6px 10px", color: "#424242", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.error ? <span style={{ color: "#f44336" }}>{r.error}</span> : r.answer_snippet}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ConfigLab() {
  const [scenarios, setScenarios] = useState<Scenario[]>(loadScenarios)
  const [currentResults, setCurrentResults] = useState<ScenarioResult[]>([])
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [runningAll, setRunningAll] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => { saveScenarios(scenarios) }, [scenarios])

  function addScenario(s: Scenario) {
    setScenarios(prev => [...prev, s])
  }

  function deleteScenario(id: string) {
    setScenarios(prev => prev.filter(s => s.id !== id))
  }

  async function runOne(scenario: Scenario) {
    setRunningIds(prev => new Set([...prev, scenario.id]))
    const result = await runScenario(scenario)
    setCurrentResults(prev => {
      const filtered = prev.filter(r => r.scenario_id !== scenario.id)
      return [...filtered, result]
    })
    setRunningIds(prev => { const n = new Set(prev); n.delete(scenario.id); return n })
  }

  async function runAll() {
    if (!scenarios.length) return
    setRunningAll(true)
    setCurrentResults([])
    const results: ScenarioResult[] = []
    for (const s of scenarios) {
      setRunningIds(prev => new Set([...prev, s.id]))
      const r = await runScenario(s)
      results.push(r)
      setCurrentResults([...results])
      setRunningIds(prev => { const n = new Set(prev); n.delete(s.id); return n })
    }
    // Save run to history
    const run: TestRun = {
      run_id: uid(),
      ts: new Date().toLocaleString(),
      config_snapshot: "manual run",
      results,
    }
    const runs = [run, ...loadRuns()].slice(0, 20)
    saveRuns(runs)
    setRunningAll(false)
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
  }

  const passCount = currentResults.filter(r => r.pass === true).length
  const failCount = currentResults.filter(r => r.pass === false).length

  return (
    <Box sx={{ p: 3, maxWidth: 1200 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "#1a237e" }}>Config Lab</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {AGENT.capability} / {AGENT.usecase} / {AGENT.type}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<EditIcon />} variant="outlined" size="small" onClick={() => setEditorOpen(true)}>
            Edit Config
          </Button>
          <Button
            startIcon={runningAll ? <CircularProgress size={14} /> : <PlayArrowIcon />}
            variant="contained" size="small"
            onClick={runAll}
            disabled={runningAll || scenarios.length === 0}
          >
            Run All ({scenarios.length})
          </Button>
        </Stack>
      </Box>

      <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>

        {/* Scenarios */}
        <Box sx={{ width: 300, flexShrink: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#424242", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Scenarios ({scenarios.length})
            </Typography>
            <IconButton size="small" onClick={() => setAddOpen(true)} sx={{ color: "#1a237e" }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>
          {scenarios.length === 0 && (
            <Typography sx={{ fontSize: 12, color: "#bdbdbd", py: 2, textAlign: "center" }}>
              No scenarios yet. Click + to add one.
            </Typography>
          )}
          {scenarios.map(s => (
            <ScenarioRow
              key={s.id}
              scenario={s}
              onDelete={() => deleteScenario(s.id)}
              onRun={() => runOne(s)}
              running={runningIds.has(s.id)}
            />
          ))}
        </Box>

        {/* Current Run Results */}
        <Box sx={{ flex: 1, minWidth: 0 }} ref={resultsRef}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#424242", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Current Run
            </Typography>
            {currentResults.length > 0 && (
              <>
                <Chip label={`${passCount} passed`} size="small" color="success" sx={{ fontSize: 10, height: 20 }} />
                {failCount > 0 && <Chip label={`${failCount} failed`} size="small" color="error" sx={{ fontSize: 10, height: 20 }} />}
              </>
            )}
          </Box>
          {currentResults.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
              <Typography sx={{ color: "#bdbdbd", fontSize: 13 }}>
                Run scenarios to see results here.
              </Typography>
            </Paper>
          ) : (
            <Paper variant="outlined">
              <ResultsTable results={currentResults} />
            </Paper>
          )}
        </Box>
      </Box>

      <ConfigEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} />
      <AddScenarioDialog open={addOpen} onClose={() => setAddOpen(false)} onSave={addScenario} />
    </Box>
  )
}
