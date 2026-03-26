import { useEffect, useState } from "react"
import {
  Box, Typography, Button, CircularProgress, Chip, Paper,
  Table, TableBody, TableCell, TableRow, Alert, Divider, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material"
import RefreshIcon from "@mui/icons-material/Refresh"
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch"
import StopIcon from "@mui/icons-material/Stop"
import DeleteForeverIcon from "@mui/icons-material/DeleteForever"
import { getWorkspaceStatus, startWorkspace, stopWorkspace, deleteWorkspace } from "../api/factoryApi"

interface WorkspaceState {
  status: "running" | "stopped" | "none"
  repos: { agent_repo: string | null; app_repo: string | null }
  ports: { resolved_runtime_port: number | null; resolved_app_port: number | null }
  urls: { agent_runtime_url: string | null; app_ui_url: string | null; tool_gateway_url: string | null }
}

export default function Workspaces() {
  const [state, setState] = useState<WorkspaceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [alert, setAlert] = useState<{ type: "success" | "error"; msg: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await getWorkspaceStatus()
      setState(res.data)
    } catch {
      setState(null)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const showAlert = (type: "success" | "error", msg: string) => {
    setAlert({ type, msg })
    setTimeout(() => setAlert(null), 5000)
  }

  const handleRestart = async () => {
    if (!state?.repos?.agent_repo || !state?.repos?.app_repo) return
    setBusy(true)
    try {
      await startWorkspace(state.repos.agent_repo, state.repos.app_repo)
      showAlert("success", "Workspace restarted.")
      await load()
    } catch (e: any) {
      showAlert("error", `Failed to restart: ${e?.message || "unknown error"}`)
    }
    setBusy(false)
  }

  const handleStop = async () => {
    setBusy(true)
    try {
      const res = await stopWorkspace()
      if (!res.data?.ok) throw new Error(res.data?.error || "unknown error")
      showAlert("success", "Workspace stopped. Repo is preserved.")
      await load()
    } catch (e: any) {
      showAlert("error", `Failed to stop: ${e?.message || "unknown error"}`)
    }
    setBusy(false)
  }

  const handleDelete = async () => {
    setConfirmDelete(false)
    setBusy(true)
    try {
      const res = await deleteWorkspace()
      if (!res.data?.ok) throw new Error(res.data?.error || "unknown error")
      showAlert("success", "Workspace deleted. Repo and registry records removed.")
      await load()
    } catch (e: any) {
      showAlert("error", `Failed to delete: ${e?.message || "unknown error"}`)
    }
    setBusy(false)
  }

  const hasWorkspace = state?.repos?.agent_repo
  const isRunning = state?.status === "running"
  const isStopped = state?.status === "stopped"

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h6" fontWeight={700}>Workspaces</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refresh</Button>
      </Box>

      {alert && (
        <Alert severity={alert.type} sx={{ mb: 2 }} onClose={() => setAlert(null)}>
          {alert.msg}
        </Alert>
      )}

      {loading ? (
        <CircularProgress size={24} />
      ) : !hasWorkspace ? (
        <Box sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>
          <Typography>No workspace is currently active.</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>Use Create Agent to scaffold and start a workspace.</Typography>
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ p: 3, maxWidth: 660 }}>

          {/* Header + status badge */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={700}>Active Workspace</Typography>
            <Chip
              label={isRunning ? "running" : "stopped"}
              size="small"
              color={isRunning ? "success" : "default"}
              sx={{ fontWeight: 600 }}
            />
          </Box>

          {/* Repo + port info */}
          <Table size="small">
            <TableBody>
              {[
                ["Agent Repo", state?.repos.agent_repo],
                ["App Repo", state?.repos.app_repo],
                ["Runtime Port", state?.ports.resolved_runtime_port],
                ["UI Port", state?.ports.resolved_app_port],
              ].map(([label, val]) => (
                <TableRow key={String(label)}>
                  <TableCell sx={{ color: "text.secondary", border: 0, width: 160 }}>{label}</TableCell>
                  <TableCell sx={{ fontWeight: 500, border: 0 }}>{val ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* URLs — only show when running */}
          {isRunning && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>URLs</Typography>
              {[
                ["Agent Runtime", state?.urls.agent_runtime_url],
                ["App UI", state?.urls.app_ui_url],
                ["Tool Gateway", state?.urls.tool_gateway_url],
              ].map(([label, url]) => (
                <Box key={String(label)} sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "center" }}>
                  <Typography variant="body2" color="text.secondary" sx={{ width: 140 }}>{label}</Typography>
                  {url ? (
                    <Typography
                      variant="body2"
                      component="a"
                      href={String(url)}
                      target="_blank"
                      rel="noreferrer"
                      sx={{ color: "primary.main" }}
                    >
                      {url}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.disabled">—</Typography>
                  )}
                </Box>
              ))}
            </>
          )}

          {/* Actions */}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>

            {/* Restart — always available */}
            <Button
              variant="contained"
              size="small"
              startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <RocketLaunchIcon />}
              onClick={handleRestart}
              disabled={busy}
            >
              Restart
            </Button>

            {/* Stop — only when running */}
            {isRunning && (
              <Button
                variant="outlined"
                size="small"
                color="warning"
                startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <StopIcon />}
                onClick={handleStop}
                disabled={busy}
              >
                Stop
              </Button>
            )}

            {/* Delete — only when stopped */}
            {isStopped && (
              <Button
                variant="outlined"
                size="small"
                color="error"
                startIcon={<DeleteForeverIcon />}
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete Workspace
              </Button>
            )}
          </Box>

          {isStopped && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
              Workspace is stopped. Repo is preserved. Restart to bring it back, or Delete to remove permanently.
            </Typography>
          )}
        </Paper>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle sx={{ color: "error.main", fontWeight: 700 }}>Delete Workspace?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete the generated repo and remove all registry records
            for <strong>{state?.repos.agent_repo}</strong>.
            <br /><br />
            Shared infrastructure (tool gateway, prompt service, support API) will not be affected.
            <br /><br />
            <strong>This cannot be undone.</strong>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Yes, Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
