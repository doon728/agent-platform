import { useEffect, useState, useRef } from "react"
import {
  Box, Typography, Button, CircularProgress, Chip, Paper,
  Alert, Divider, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Tooltip, IconButton,
} from "@mui/material"
import RefreshIcon from "@mui/icons-material/Refresh"
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch"
import StopIcon from "@mui/icons-material/Stop"
import DeleteForeverIcon from "@mui/icons-material/DeleteForever"
import OpenInNewIcon from "@mui/icons-material/OpenInNew"
import { getAgentStatus, restartAgent, stopAgent, deleteAgent } from "../api/factoryApi"

interface AgentStatus {
  capability_name: string
  usecase_name: string
  agent_type: string
  agent_repo_name: string
  app_repo_name: string
  status: "running" | "stopped"
  runtime_url: string
  features: Record<string, boolean>
}

const STATUS_COLOR: Record<string, "success" | "default"> = {
  running: "success",
  stopped: "default",
}

export default function Workspaces() {
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busyRepo, setBusyRepo] = useState<string | null>(null)
  const [alert, setAlert] = useState<{ type: "success" | "error"; msg: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AgentStatus | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const res = await getAgentStatus()
      setAgents(res.data?.agents ?? [])
    } catch {
      if (!quiet) setAgents([])
    }
    if (!quiet) setLoading(false)
  }

  // Auto-refresh every 8s when any agent is running
  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const anyRunning = agents.some(a => a.status === "running")
    if (anyRunning) {
      timerRef.current = setInterval(() => load(true), 8000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [agents])

  const showAlert = (type: "success" | "error", msg: string) => {
    setAlert({ type, msg })
    setTimeout(() => setAlert(null), 5000)
  }

  const handleStart = async (agent: AgentStatus) => {
    setBusyRepo(agent.agent_repo_name)
    try {
      await restartAgent(agent.agent_repo_name, agent.app_repo_name ?? "")
      showAlert("success", `Started ${agent.agent_repo_name}.`)
      await load()
    } catch (e: any) {
      showAlert("error", `Failed to start: ${e?.message ?? "unknown error"}`)
    }
    setBusyRepo(null)
  }

  const handleStop = async (agent: AgentStatus) => {
    setBusyRepo(agent.agent_repo_name)
    try {
      const res = await stopAgent(agent.agent_repo_name)
      if (!res.data?.ok) throw new Error(res.data?.error ?? "unknown error")
      showAlert("success", `Stopped ${agent.agent_repo_name}.`)
      await load()
    } catch (e: any) {
      showAlert("error", `Failed to stop: ${e?.message ?? "unknown error"}`)
    }
    setBusyRepo(null)
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    const agent = confirmDelete
    setConfirmDelete(null)
    setBusyRepo(agent.agent_repo_name)
    try {
      const res = await deleteAgent(agent.agent_repo_name)
      if (!res.data?.ok) throw new Error((res.data?.errors ?? []).join(", ") || "unknown error")
      showAlert("success", `Deleted ${agent.agent_repo_name} and its files.`)
      await load()
    } catch (e: any) {
      showAlert("error", `Failed to delete: ${e?.message ?? "unknown error"}`)
    }
    setBusyRepo(null)
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h6" fontWeight={700}>Workspaces</Typography>
        <Typography variant="body2" color="text.secondary">
          {agents.length} agent{agents.length !== 1 ? "s" : ""} registered
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
          onClick={() => load()}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {alert && (
        <Alert severity={alert.type} sx={{ mb: 2 }} onClose={() => setAlert(null)}>
          {alert.msg}
        </Alert>
      )}

      {loading ? (
        <CircularProgress size={24} />
      ) : agents.length === 0 ? (
        <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>
          <Typography>No agents registered.</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Use Create Agent to scaffold and register a new agent.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {agents.map((agent) => (
            <AgentCard
              key={agent.agent_repo_name}
              agent={agent}
              busy={busyRepo === agent.agent_repo_name}
              onStart={() => handleStart(agent)}
              onStop={() => handleStop(agent)}
              onDelete={() => setConfirmDelete(agent)}
            />
          ))}
        </Box>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogTitle sx={{ color: "error.main", fontWeight: 700 }}>Delete Agent?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete{" "}
            <strong>{confirmDelete?.agent_repo_name}</strong>
            {confirmDelete?.app_repo_name ? (
              <> and its app repo <strong>{confirmDelete.app_repo_name}</strong></>
            ) : null}
            , and remove all registry records.
            <br /><br />
            Shared infrastructure (tool gateway, prompt service, support API) is not affected.
            <br /><br />
            <strong>This cannot be undone.</strong>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Yes, Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ─── AgentCard ────────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: AgentStatus
  busy: boolean
  onStart: () => void
  onStop: () => void
  onDelete: () => void
}

function AgentCard({ agent, busy, onStart, onStop, onDelete }: AgentCardProps) {
  const isRunning = agent.status === "running"

  const enabledFeatures = Object.entries(agent.features ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k)

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderColor: isRunning ? "#22c55e40" : "#e2e8f0",
        bgcolor: isRunning ? "#f0fdf4" : "white",
      }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 1.5 }}>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            <Typography fontWeight={700} fontSize={15}>
              {agent.agent_repo_name}
            </Typography>
            <Chip
              label={agent.status}
              size="small"
              color={STATUS_COLOR[agent.status] ?? "default"}
              sx={{ fontWeight: 600, height: 20, fontSize: 11 }}
            />
            <Chip
              label={agent.agent_type}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: 11 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {agent.capability_name} / {agent.usecase_name}
          </Typography>
        </Box>

        {/* Action buttons */}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexShrink: 0 }}>
          {!isRunning && (
            <Button
              size="small"
              variant="contained"
              startIcon={busy ? <CircularProgress size={13} color="inherit" /> : <RocketLaunchIcon />}
              onClick={onStart}
              disabled={busy}
              sx={{ minWidth: 80 }}
            >
              Start
            </Button>
          )}
          {isRunning && (
            <>
              {agent.runtime_url && (
                <Tooltip title="Open agent runtime">
                  <IconButton
                    size="small"
                    component="a"
                    href={agent.runtime_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={busy ? <CircularProgress size={13} color="inherit" /> : <StopIcon />}
                onClick={onStop}
                disabled={busy}
                sx={{ minWidth: 70 }}
              >
                Stop
              </Button>
            </>
          )}
          <Tooltip title="Delete agent and repos permanently">
            <span>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteForeverIcon />}
                onClick={onDelete}
                disabled={busy || isRunning}
                sx={{ minWidth: 80 }}
              >
                Delete
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* Features + runtime URL */}
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
        {enabledFeatures.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {enabledFeatures.map(f => (
              <Chip
                key={f}
                label={f}
                size="small"
                sx={{
                  height: 18, fontSize: 10,
                  bgcolor: "#ede9fe", color: "#6d28d9",
                  fontWeight: 600,
                }}
              />
            ))}
          </Box>
        )}

        {isRunning && agent.runtime_url && (
          <>
            {enabledFeatures.length > 0 && <Divider orientation="vertical" flexItem />}
            <Typography
              variant="caption"
              component="a"
              href={agent.runtime_url}
              target="_blank"
              rel="noreferrer"
              sx={{ color: "primary.main", textDecoration: "none" }}
            >
              {agent.runtime_url}
            </Typography>
          </>
        )}

        {!isRunning && (
          <Typography variant="caption" color="text.disabled">
            Stopped — Start to bring it up
          </Typography>
        )}
      </Box>

      {isRunning && (
        <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: "block" }}>
          Stop the agent before deleting.
        </Typography>
      )}
    </Paper>
  )
}
