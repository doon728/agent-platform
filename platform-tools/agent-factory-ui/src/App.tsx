import { useState } from "react"
import ApplicationForm from "./components/ApplicationForm"
import PromptLifecycle from "./pages/PromptLifecycle"

function App() {
  const [mode, setMode] = useState<"factory" | "prompt">("factory")

  return (
    <div>
      <div style={{ padding: 20, borderBottom: "1px solid #ddd" }}>
        <button onClick={() => setMode("factory")}>Agent Factory</button>
        <button onClick={() => setMode("prompt")} style={{ marginLeft: 10 }}>
          Prompt Governance
        </button>
      </div>

      {mode === "factory" && <ApplicationForm />}
      {mode === "prompt" && <PromptLifecycle />}
    </div>
  )
}

export default App