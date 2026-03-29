import axios from "axios"

const api = axios.create({
  baseURL: "http://localhost:8080",
})

// ── Tool types ────────────────────────────────────────────────────────────────

export interface Tool {
  name: string
  description: string
  endpoint_url: string
  primary_arg: string
  mode: string
  tags: string[]
  db_type: string | null
  strategy: string | null
  enabled: boolean
  created_at: string | null
  updated_at: string | null
  input_schema: object | null
  output_schema: object | null
  status: string   // 'draft' | 'active' | 'disabled'
}

export interface ToolCreatePayload {
  name: string
  description: string
  endpoint_url: string
  primary_arg: string
  mode: string
  tags: string[]
  db_type?: string | null
  strategy?: string | null
  input_schema?: object | null
  output_schema?: object | null
  status?: string
}

export interface ToolUpdatePayload {
  description?: string
  endpoint_url?: string
  primary_arg?: string
  mode?: string
  tags?: string[]
  db_type?: string | null
  strategy?: string | null
  enabled?: boolean
  input_schema?: object | null
  output_schema?: object | null
  status?: string
}

export const listTools = () => api.get<{ ok: boolean; tools: Tool[] }>("/tools")
export const createTool = (payload: ToolCreatePayload) => api.post("/tools", payload)
export const updateTool = (name: string, payload: ToolUpdatePayload) => api.patch(`/tools/${name}`, payload)
export const deleteTool = (name: string) => api.delete(`/tools/${name}`)

// ── KB types ──────────────────────────────────────────────────────────────────

export interface KBDocument {
  doc_id: string
  title: string
  chunk_count: number
  ingested_at: string | null
}

export interface KBStats {
  total_documents: number
  total_chunks: number
  embedding_model: string
}

export const listKBDocuments = () => api.get<{ ok: boolean; documents: KBDocument[] }>("/kb/documents")
export const getKBStats = () => api.get<{ ok: boolean } & KBStats>("/kb/stats")
export const deleteKBDocument = (doc_id: string) => api.delete(`/kb/documents/${encodeURIComponent(doc_id)}`)
export const ingestDocument = (file: File) => {
  const form = new FormData()
  form.append("file", file)
  return api.post<{ ok: boolean; doc_id: string; title: string; chunks_ingested: number }>("/kb/ingest", form, {
    headers: { "Content-Type": "multipart/form-data" },
  })
}
