import { useEffect, useState, useRef } from "react"
import {
  Box, Typography, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, IconButton, Alert, CircularProgress,
  Stack, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  LinearProgress,
} from "@mui/material"
import DeleteIcon from "@mui/icons-material/Delete"
import UploadFileIcon from "@mui/icons-material/UploadFile"
import { listKBDocuments, getKBStats, deleteKBDocument, ingestDocument, type KBDocument, type KBStats } from "../api/gatewayApi"

export default function KnowledgeBase() {
  const [docs, setDocs] = useState<KBDocument[]>([])
  const [stats, setStats] = useState<KBStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ title: string; chunks: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [deleteTarget, setDeleteTarget] = useState<KBDocument | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [docsRes, statsRes] = await Promise.all([listKBDocuments(), getKBStats()])
      setDocs(docsRes.data.documents)
      setStats({ total_documents: statsRes.data.total_documents, total_chunks: statsRes.data.total_chunks, embedding_model: statsRes.data.embedding_model })
    } catch {
      setError("Failed to load knowledge base data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadError(null)
    setUploadResult(null)

    try {
      const res = await ingestDocument(file)
      if (!res.data.ok) {
        setUploadError((res.data as any).error ?? "Upload failed")
      } else {
        setUploadResult({ title: res.data.title, chunks: res.data.chunks_ingested })
        await load()
      }
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? (err as any)?.message ?? "Upload failed"
      setUploadError(msg)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await deleteKBDocument(deleteTarget.doc_id)
      if (!(res.data as any).ok) {
        setError((res.data as any).error ?? "Delete failed")
      } else {
        setDeleteTarget(null)
        await load()
      }
    } catch (err: unknown) {
      setError((err as any)?.message ?? "Delete failed")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Knowledge Base</Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Documents indexed in the vector store. Used by retrieval tools (search_kb).
          </Typography>
        </Box>
        <Box>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.md"
            style={{ display: "none" }}
            onChange={e => void handleFileChange(e)}
          />
          <Button
            variant="contained"
            startIcon={<UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Ingesting..." : "Upload Document"}
          </Button>
        </Box>
      </Stack>

      {uploading && <LinearProgress sx={{ mb: 2 }} />}

      {uploadResult && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setUploadResult(null)}>
          <b>{uploadResult.title}</b> ingested — {uploadResult.chunks} chunks embedded
        </Alert>
      )}

      {uploadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Stats bar */}
      {stats && (
        <Stack direction="row" spacing={2} mb={3}>
          <Chip label={`${stats.total_documents} documents`} color="primary" variant="outlined" />
          <Chip label={`${stats.total_chunks} chunks`} variant="outlined" />
          <Chip label={`model: ${stats.embedding_model}`} variant="outlined" />
        </Stack>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
      ) : docs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">No documents indexed yet.</Typography>
          <Typography variant="body2" color="text.secondary" mt={1}>
            Upload a .txt or .pdf file to get started.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#f5f6fa" }}>
                <TableCell><b>Title</b></TableCell>
                <TableCell><b>Doc ID</b></TableCell>
                <TableCell><b>Chunks</b></TableCell>
                <TableCell><b>Ingested At</b></TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {docs.map(doc => (
                <TableRow key={doc.doc_id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{doc.title}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                      {doc.doc_id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={doc.chunk_count} size="small" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {doc.ingested_at ? new Date(doc.ingested_at).toLocaleString() : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" color="error" onClick={() => setDeleteTarget(doc)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Document</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <b>{deleteTarget?.title}</b>? This removes all {deleteTarget?.chunk_count} chunks from the vector store.
            The search_kb tool will no longer return content from this document.
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
