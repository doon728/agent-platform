import { useState } from "react"
import {
  Box, Button, Chip, Collapse, IconButton, Paper, Stack, Typography,
} from "@mui/material"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import DeleteIcon from "@mui/icons-material/Delete"
import CheckCircleIcon from "@mui/icons-material/CheckCircle"
import CancelIcon from "@mui/icons-material/Cancel"

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
  config_snapshot: string
  results: ScenarioResult[]
}

function loadRuns(): TestRun[] {
  try { return JSON.parse(localStorage.getItem("config-lab:runs") || "[]") } catch { return [] }
}
function saveRuns(runs: TestRun[]) {
  localStorage.setItem("config-lab:runs", JSON.stringify(runs))
}

function exportCsv(runs: TestRun[]) {
  const rows = ["Run ID,Timestamp,Scenario,Tool Called,Route,ms,Pass,Answer"]
  for (const run of runs) {
    for (const r of run.results) {
      rows.push([
        run.run_id, run.ts, r.scenario_name, r.tool_called,
        r.route_type, r.latency_ms,
        r.pass === true ? "pass" : r.pass === false ? "fail" : "—",
        `"${r.answer_snippet.replace(/"/g, "'")}"`,
      ].join(","))
    }
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `test-results-${Date.now()}.csv`
  a.click()
}

function RunBlock({ run, onDelete }: { run: TestRun; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(true)
  const pass = run.results.filter(r => r.pass === true).length
  const fail = run.results.filter(r => r.pass === false).length
  const total = run.results.length

  return (
    <Paper variant="outlined" sx={{ mb: 2, overflow: "hidden" }}>
      {/* Run header */}
      <Box sx={{
        px: 2, py: 1.5, background: "#f5f6fa",
        display: "flex", alignItems: "center", gap: 1, cursor: "pointer",
      }} onClick={() => setExpanded(v => !v)}>
        <IconButton size="small" sx={{ p: 0 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#1a237e", flex: 1 }}>
          {run.ts}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          <Chip label={`${total} scenarios`} size="small" sx={{ fontSize: 10, height: 20 }} />
          {pass > 0 && <Chip label={`${pass} passed`} size="small" color="success" sx={{ fontSize: 10, height: 20 }} />}
          {fail > 0 && <Chip label={`${fail} failed`} size="small" color="error" sx={{ fontSize: 10, height: 20 }} />}
        </Stack>
        <IconButton size="small" onClick={e => { e.stopPropagation(); onDelete() }} sx={{ color: "#bdbdbd" }}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Results table */}
      <Collapse in={expanded}>
        <Box sx={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Scenario", "Tool Called", "Route", "ms", "✓/✗", "Answer"].map(c => (
                  <th key={c} style={{
                    textAlign: "left", padding: "6px 12px",
                    borderBottom: "1px solid #e0e0e0", color: "#757575",
                    fontWeight: 600, fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap",
                  }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.results.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fafafa" : "white" }}>
                  <td style={{ padding: "6px 12px", fontWeight: 600, color: "#1a237e" }}>{r.scenario_name}</td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#5c6bc0" }}>{r.tool_called}</td>
                  <td style={{ padding: "6px 12px", color: "#757575" }}>{r.route_type}</td>
                  <td style={{ padding: "6px 12px", color: "#757575" }}>{r.latency_ms}</td>
                  <td style={{ padding: "6px 12px" }}>
                    {r.pass === true && <CheckCircleIcon sx={{ fontSize: 16, color: "success.main" }} />}
                    {r.pass === false && <CancelIcon sx={{ fontSize: 16, color: "error.main" }} />}
                    {r.pass === null && "—"}
                  </td>
                  <td style={{
                    padding: "6px 12px", color: "#424242",
                    maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {r.error
                      ? <span style={{ color: "#f44336" }}>{r.error}</span>
                      : r.answer_snippet}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </Collapse>
    </Paper>
  )
}

export default function TestResults() {
  const [runs, setRuns] = useState<TestRun[]>(loadRuns)

  function deleteRun(id: string) {
    const updated = runs.filter(r => r.run_id !== id)
    setRuns(updated)
    saveRuns(updated)
  }

  function clearAll() {
    setRuns([])
    saveRuns([])
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1200 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "#1a237e" }}>Test Results</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            All saved runs · {runs.length} total
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {runs.length > 0 && (
            <>
              <Button size="small" variant="outlined" onClick={() => exportCsv(runs)}>Export CSV</Button>
              <Button size="small" variant="outlined" color="error" onClick={clearAll}>Clear All</Button>
            </>
          )}
        </Stack>
      </Box>

      {runs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: "center" }}>
          <Typography sx={{ color: "#bdbdbd", fontSize: 14 }}>
            No runs yet. Go to Config Lab and run some scenarios.
          </Typography>
        </Paper>
      ) : (
        runs.map(run => (
          <RunBlock key={run.run_id} run={run} onDelete={() => deleteRun(run.run_id)} />
        ))
      )}
    </Box>
  )
}
