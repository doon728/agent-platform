import { useEffect, useState } from "react"
import { listPrompts, approvePrompt, activatePrompt } from "../api/factoryApi"

export default function PromptLifecycle() {
  const [prompts, setPrompts] = useState<any[]>([])

  const load = async () => {
    const res = await listPrompts()
    setPrompts(res.data.prompts || [])
  }

  useEffect(() => {
    load()
  }, [])

  const approve = async (id: string) => {
    const version = Number(prompt("Version to approve?"))
    await approvePrompt(id, version)
    alert("Approved")
    load()
  }

  const activate = async (id: string) => {
    const version = Number(prompt("Version to activate?"))
    await activatePrompt(id, version)
    alert("Activated")
    load()
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>Prompt Lifecycle</h2>

      {prompts.map((p: any) => (
        <div key={p.prompt_id} style={{ border: "1px solid #ddd", margin: 10, padding: 10 }}>
          <div><b>Name:</b> {p.prompt_name}</div>
          <div><b>App:</b> {p.app_name}</div>
          <div><b>Status:</b> {p.lifecycle_status}</div>
          <div><b>Prompt ID:</b> {p.prompt_id}</div>
          <div><b>Active Version ID:</b> {p.active_version_id || "none"}</div>
          <div><b>Use version:</b> 1 or 2</div>

          <button onClick={() => approve(p.prompt_id)}>Approve Version</button>
          <button onClick={() => activate(p.prompt_id)}>Activate Version</button>
        </div>
      ))}
    </div>
  )
}