import { useEffect, useState } from "react"
import {
  Box, Typography, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Select, MenuItem, FormControl,
  InputLabel, Switch, Alert, CircularProgress, Tooltip,
  Stack, List, ListItem, ListItemIcon, ListItemText,
} from "@mui/material"
import AddIcon from "@mui/icons-material/Add"
import EditIcon from "@mui/icons-material/Edit"
import DeleteIcon from "@mui/icons-material/Delete"
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank"
import { listTools, createTool, updateTool, deleteTool, type Tool, type ToolCreatePayload } from "../api/gatewayApi"

function isDevEndpoint(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1") || url.includes("/internal/")
}

const EMPTY_FORM: ToolCreatePayload = {
  name: "",
  description: "",
  endpoint_url: "",
  primary_arg: "query",
  mode: "read",
  tags: [],
  db_type: null,
  strategy: null,
  input_schema: null,
  output_schema: null,
  status: "draft",
}

const STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error"> = {
  draft: "warning",
  active: "success",
  disabled: "error",
}

function jsonOrNull(text: string): object | null | "error" {
  if (!text.trim()) return null
  try { return JSON.parse(text) } catch { return "error" }
}

export default function ToolRegistry() {
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<Tool | null>(null)
  const [form, setForm] = useState<ToolCreatePayload>(EMPTY_FORM)
  const [tagsText, setTagsText] = useState("")
  const [inputSchemaText, setInputSchemaText] = useState("")
  const [outputSchemaText, setOutputSchemaText] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<Tool | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [reminderTool, setReminderTool] = useState<{ name: string; isNew: boolean } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await listTools()
      setTools(res.data.tools)
    } catch {
      setError("Failed to load tools from gateway")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const openAdd = () => {
    setEditingTool(null)
    setForm(EMPTY_FORM)
    setTagsText("")
    setInputSchemaText("")
    setOutputSchemaText("")
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (tool: Tool) => {
    setEditingTool(tool)
    setForm({
      name: tool.name,
      description: tool.description,
      endpoint_url: tool.endpoint_url,
      primary_arg: tool.primary_arg,
      mode: tool.mode,
      tags: tool.tags,
      db_type: tool.db_type,
      strategy: tool.strategy,
      input_schema: tool.input_schema,
      output_schema: tool.output_schema,
      status: tool.status,
    })
    setTagsText(tool.tags.join(", "))
    setInputSchemaText(tool.input_schema ? JSON.stringify(tool.input_schema, null, 2) : "")
    setOutputSchemaText(tool.output_schema ? JSON.stringify(tool.output_schema, null, 2) : "")
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setFormError(null)

    if (!form.name.trim() || !form.description.trim() || !form.endpoint_url.trim()) {
      setFormError("Name, description, and endpoint URL are required.")
      return
    }

    const parsedInput = jsonOrNull(inputSchemaText)
    const parsedOutput = jsonOrNull(outputSchemaText)
    if (parsedInput === "error") { setFormError("Input schema is not valid JSON."); return }
    if (parsedOutput === "error") { setFormError("Output schema is not valid JSON."); return }

    const tags = tagsText.split(",").map(t => t.trim()).filter(Boolean)
    const payload = { ...form, tags, input_schema: parsedInput, output_schema: parsedOutput }

    setSaving(true)
    try {
      const isNew = !editingTool
      if (editingTool) {
        await updateTool(editingTool.name, payload)
      } else {
        await createTool(payload)
      }
      setDialogOpen(false)
      await load()
      if (isDevEndpoint(payload.endpoint_url)) {
        setReminderTool({ name: payload.name, isNew })
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setFormError(msg ?? "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteTool(deleteTarget.name)
      setDeleteTarget(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleEnabled = async (tool: Tool) => {
    await updateTool(tool.name, { enabled: !tool.enabled })
    await load()
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Tool Registry</Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            All tools registered in the gateway. Define schema first — developer implements the handler against it.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
          Add Tool
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#f5f6fa" }}>
                <TableCell><b>Name</b></TableCell>
                <TableCell><b>Description</b></TableCell>
                <TableCell><b>Mode</b></TableCell>
                <TableCell><b>Tags</b></TableCell>
                <TableCell><b>Endpoint URL</b></TableCell>
                <TableCell><b>Schema</b></TableCell>
                <TableCell><b>Status</b></TableCell>
                <TableCell><b>Enabled</b></TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {tools.map(tool => (
                <TableRow key={tool.name} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600} fontFamily="monospace">
                      {tool.name}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" color="text.secondary">{tool.description}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={tool.mode}
                      size="small"
                      color={tool.mode === "write" ? "warning" : "default"}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {tool.tags.map(tag => (
                        <Chip key={tag} label={tag} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Tooltip title={tool.endpoint_url}>
                      <Typography variant="body2" fontFamily="monospace" noWrap sx={{ maxWidth: 200 }}>
                        {tool.endpoint_url}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Chip
                        label="input"
                        size="small"
                        color={tool.input_schema ? "success" : "default"}
                        variant={tool.input_schema ? "filled" : "outlined"}
                      />
                      <Chip
                        label="output"
                        size="small"
                        color={tool.output_schema ? "success" : "default"}
                        variant={tool.output_schema ? "filled" : "outlined"}
                      />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Chip
                        label={tool.status}
                        size="small"
                        color={STATUS_COLOR[tool.status] ?? "default"}
                      />
                      {tool.status === "draft" && (
                        <Tooltip title="Mark as active — developer has deployed the handler">
                          <Button
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: 11, py: 0, px: 1, minWidth: 0 }}
                            onClick={() => void updateTool(tool.name, { status: "active" }).then(load)}
                          >
                            Activate
                          </Button>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={tool.enabled}
                      onChange={() => void handleToggleEnabled(tool)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(tool)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => setDeleteTarget(tool)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingTool ? `Edit: ${editingTool.name}` : "Add Tool"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} pt={1}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <Stack direction="row" spacing={2}>
              <TextField
                label="Tool Name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={!!editingTool}
                fullWidth
                size="small"
                placeholder="e.g. get_member_summary"
                helperText="Must match the name agents use in agent.yaml"
              />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Mode</InputLabel>
                <Select value={form.mode} label="Mode" onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}>
                  <MenuItem value="read">read</MenuItem>
                  <MenuItem value="write">write</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <TextField
              label="Description"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              fullWidth
              size="small"
              multiline
              rows={2}
              helperText="Shown to the LLM — must be precise enough for the planner to pick this tool for the right intent"
            />

            <TextField
              label="Endpoint URL"
              value={form.endpoint_url}
              onChange={e => setForm(f => ({ ...f, endpoint_url: e.target.value }))}
              fullWidth
              size="small"
              placeholder="http://localhost:8080/internal/tools/get_member_summary"
              helperText="Where the gateway POSTs the invocation payload. Change this to swap the backend — no other changes needed."
            />

            <Stack direction="row" spacing={2}>
              <TextField
                label="Primary Arg"
                value={form.primary_arg}
                onChange={e => setForm(f => ({ ...f, primary_arg: e.target.value }))}
                size="small"
                helperText="Main input field name (used by planner)"
              />
              <TextField
                label="Tags (comma separated)"
                value={tagsText}
                onChange={e => setTagsText(e.target.value)}
                fullWidth
                size="small"
                placeholder="member, summary, care_management"
              />
            </Stack>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={(form as ToolCreatePayload & { status?: string }).status ?? "draft"}
                label="Status"
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              >
                <MenuItem value="draft">draft — handler not deployed yet</MenuItem>
                <MenuItem value="active">active — ready for agents</MenuItem>
                <MenuItem value="disabled">disabled</MenuItem>
              </Select>
            </FormControl>

            <Stack direction="row" spacing={2}>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>DB Type</InputLabel>
                <Select
                  value={form.db_type ?? ""}
                  label="DB Type"
                  onChange={e => setForm(f => ({ ...f, db_type: e.target.value || null }))}
                >
                  <MenuItem value="">(none)</MenuItem>
                  <MenuItem value="vector_db">vector_db</MenuItem>
                  <MenuItem value="relational">relational</MenuItem>
                  <MenuItem value="graph_db">graph_db</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Strategy</InputLabel>
                <Select
                  value={form.strategy ?? ""}
                  label="Strategy"
                  onChange={e => setForm(f => ({ ...f, strategy: e.target.value || null }))}
                >
                  <MenuItem value="">(none)</MenuItem>
                  <MenuItem value="semantic">semantic</MenuItem>
                  <MenuItem value="hybrid">hybrid</MenuItem>
                  <MenuItem value="keyword">keyword</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <TextField
              label="Input Schema (JSON)"
              value={inputSchemaText}
              onChange={e => setInputSchemaText(e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={6}
              placeholder={'{\n  "type": "object",\n  "properties": {\n    "member_id": {"type": "string"}\n  },\n  "required": ["member_id"]\n}'}
              helperText="JSON Schema — defines what arguments this tool accepts. Gateway validates all invocations against this."
              inputProps={{ style: { fontFamily: "monospace", fontSize: 12 } }}
            />

            <TextField
              label="Output Schema (JSON)"
              value={outputSchemaText}
              onChange={e => setOutputSchemaText(e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={6}
              placeholder={'{\n  "type": "object",\n  "properties": {\n    "found": {"type": "boolean"},\n    "data": {"type": "object"}\n  }\n}'}
              helperText="JSON Schema — defines what this tool returns. Used by the UI and future output validation."
              inputProps={{ style: { fontFamily: "monospace", fontSize: 12 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving..." : editingTool ? "Save Changes" : "Add Tool"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Developer Action Reminder */}
      <Dialog open={!!reminderTool} onClose={() => setReminderTool(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Tool {reminderTool?.isNew ? "registered" : "updated"} — developer action required
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            <b>{reminderTool?.name}</b> uses a dev endpoint (localhost/internal).
            The following steps are needed before agents can invoke it.
          </Alert>
          <List dense disablePadding>
            {reminderTool?.isNew && (
              <>
                <ListItem disableGutters>
                  <ListItemIcon sx={{ minWidth: 32 }}><CheckBoxOutlineBlankIcon fontSize="small" /></ListItemIcon>
                  <ListItemText
                    primary="Add input/output Pydantic models in registry.py"
                    secondary="Define the schema that matches what you entered in the UI"
                  />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemIcon sx={{ minWidth: 32 }}><CheckBoxOutlineBlankIcon fontSize="small" /></ListItemIcon>
                  <ListItemText
                    primary="Write the handler function in registry.py"
                    secondary="Implement the actual read/write logic against the backend"
                  />
                </ListItem>
                <ListItem disableGutters>
                  <ListItemIcon sx={{ minWidth: 32 }}><CheckBoxOutlineBlankIcon fontSize="small" /></ListItemIcon>
                  <ListItemText
                    primary={`Mount internal route in app.py`}
                    secondary={`@app.post("/internal/tools/${reminderTool?.name}")`}
                  />
                </ListItem>
              </>
            )}
            <ListItem disableGutters>
              <ListItemIcon sx={{ minWidth: 32 }}><CheckBoxOutlineBlankIcon fontSize="small" /></ListItemIcon>
              <ListItemText
                primary="Restart the gateway"
                secondary="docker compose restart tool-gateway"
              />
            </ListItem>
            <ListItem disableGutters>
              <ListItemIcon sx={{ minWidth: 32 }}><CheckBoxOutlineBlankIcon fontSize="small" /></ListItemIcon>
              <ListItemText
                primary="Add tool name to agent's allowed list in Agent Registry UI"
                secondary={`Add "${reminderTool?.name}" to tools.allowed in agent.yaml`}
              />
            </ListItem>
          </List>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            In production, point the endpoint URL at the real backend (Epic, Lambda, Pega, etc.) and none of these steps are needed.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setReminderTool(null)}>Got it</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Tool</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <b>{deleteTarget?.name}</b>? This removes it from the registry.
            Any agent with this tool in its allowed list will fail to invoke it.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
