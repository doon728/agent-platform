import { useEffect, useState } from "react"
import { listPrompts, approvePrompt, activatePrompt } from "../api/factoryApi"

export default function PromptLifecycle() {
  const [prompts, setPrompts] = useState<any[]>([])
  const [message, setMessage] = useState("")

  const load = async () => {
    try {
      const res = await listPrompts()
      setPrompts(res.data.prompts || [])
    } catch (err: any) {
      console.error(err)
      setMessage(
        `Error loading prompts: ${err?.response?.data?.detail || err.message}`
      )
    }
  }

  useEffect(() => {
    load()
  }, [])

  const approve = async (id: string) => {
    try {
      const version = Number(window.prompt("Version to approve?", "1"))
      if (!version) return
      await approvePrompt(id, version)
      setMessage(`Approved prompt ${id} version ${version}`)
      load()
    } catch (err: any) {
      console.error(err)
      setMessage(
        `Approve failed: ${err?.response?.data?.detail || err.message}`
      )
    }
  }

  const activate = async (id: string) => {
    try {
      const version = Number(window.prompt("Version to activate?", "1"))
      if (!version) return
      await activatePrompt(id, version)
      setMessage(`Activated prompt ${id} version ${version}`)
      load()
    } catch (err: any) {
      console.error(err)
      setMessage(
        `Activate failed: ${err?.response?.data?.detail || err.message}`
      )
    }
  }

  return (
    <div style={{ padding: 40 }}>
      <h2 style={{ marginTop: 0 }}>Prompt Governance</h2>
      <p style={{ color: "#4b5563" }}>
        Current prompt registry view. This is now reading the refactored prompt
        lifecycle model.
      </p>

      {message && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#f9fafb",
          }}
        >
          {message}
        </div>
      )}

      {prompts.length === 0 && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 16,
            background: "#fafafa",
          }}
        >
          No prompts found.
        </div>
      )}

      {prompts.map((p: any) => (
        <div
          key={p.prompt_id}
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            marginBottom: 12,
            padding: 14,
            background: "#fff",
          }}
        >
          <div><b>Name:</b> {p.prompt_name}</div>
          <div><b>Capability:</b> {p.capability_name}</div>
          <div><b>Use Case:</b> {p.usecase_name}</div>
          <div><b>Agent Type:</b> {p.agent_type}</div>
          <div><b>Prompt Type:</b> {p.prompt_type}</div>
          <div><b>Environment:</b> {p.environment}</div>
          <div><b>Lifecycle Status:</b> {p.lifecycle_status}</div>
          <div><b>Prompt ID:</b> {p.prompt_id}</div>
          <div><b>Active Version ID:</b> {p.active_version_id || "none"}</div>

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button onClick={() => approve(p.prompt_id)}>Approve Version</button>
            <button onClick={() => activate(p.prompt_id)}>Activate Version</button>
          </div>
        </div>
      ))}
    </div>
  )
}