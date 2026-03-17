import { useEffect, useState, type CSSProperties } from "react"
import {
  createApplication,
  getGatewayTools,
  getNextAvailableRepoName,
  startWorkspace,
} from "../api/factoryApi"
type GatewayTool = {
  name: string
  description?: string
  primary_arg?: string
  mode: string
  tags?: string[]
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const MODEL_OPTIONS = [
  { value: "gpt-4o-mini", label: "OpenAI / gpt-4o-mini", enabled: true },
  { value: "gpt-4.1-mini", label: "OpenAI / gpt-4.1-mini", enabled: false },
  { value: "claude-sonnet", label: "Bedrock / Claude Sonnet", enabled: false },
  { value: "claude-haiku", label: "Bedrock / Claude Haiku", enabled: false },
  { value: "nova-pro", label: "Bedrock / Nova Pro", enabled: false },
]

const AGENT_TYPE_OPTIONS = [
  { value: "chat_agent", label: "chat_agent", enabled: true },
  { value: "workflow_agent", label: "workflow_agent", enabled: false },
  { value: "supervisor_agent", label: "supervisor_agent", enabled: false },
  { value: "multi_agent", label: "multi_agent", enabled: false },
]

export default function ApplicationForm() {
  const [industry, setIndustry] = useState("")
  const [customer, setCustomer] = useState("")
  const [lob, setLob] = useState("")
  const [appName, setAppName] = useState("")
  const [repoName, setRepoName] = useState("")
  const [description, setDescription] = useState("")

  const [agentName, setAgentName] = useState("")
  const [agentRepoName, setAgentRepoName] = useState("")
  const [agentType, setAgentType] = useState("chat_agent")
  const [persona, setPersona] = useState("care_manager")
  const [usecaseName, setUsecaseName] = useState("cm_assistant")

  const [repoNameTouched, setRepoNameTouched] = useState(false)
  const [agentRepoNameTouched, setAgentRepoNameTouched] = useState(false)

  const [plannerPrompt, setPlannerPrompt] = useState(
    "You are a care-management agent planner. Your job is to decide which tool should be called next. Only choose from the available tools. Return the next tool call in this format: tool_name: argument"
  )
  const [responderPrompt, setResponderPrompt] = useState(
    "You are a healthcare care-management assistant helping nurses. Use only the provided tool data or retrieved policy content. Do not invent information. Be concise and clinically useful."
  )

  const [modelName, setModelName] = useState("gpt-4o-mini")
  const [temperature, setTemperature] = useState("0")

  // Local profile (real/wired)
  const [localHumanReviewEnabled, setLocalHumanReviewEnabled] = useState(true)

  const [localMemoryEnabled, setLocalMemoryEnabled] = useState(true)
  const [localThreadMemory, setLocalThreadMemory] = useState(true)
  const [localCaseMemory, setLocalCaseMemory] = useState(true)

  const [localRagEnabled, setLocalRagEnabled] = useState(true)
  const [localRagType, setLocalRagType] = useState("vector_rag")
  const [localTopK, setLocalTopK] = useState("3")
  const [localScoreThreshold, setLocalScoreThreshold] = useState("0.35")

  // AgentCore teaser
  const [showAgentCoreProfile, setShowAgentCoreProfile] = useState(false)
  const [agentCoreEnabled] = useState(true)
  const [agentCoreHumanReviewEnabled] = useState(true)
  const [agentCoreMemoryEnabled] = useState(true)
  const [agentCoreThreadMemory] = useState(true)
  const [agentCoreCaseMemory] = useState(true)
  const [agentCoreRagEnabled] = useState(true)
  const [agentCoreRagType] = useState("vector_rag")
  const [agentCoreTopK] = useState("3")
  const [agentCoreScoreThreshold] = useState("0.35")

  const [availableGateways, setAvailableGateways] = useState<string[]>([
    "healthcare-tool-gateway",
  ])
  const [selectedGateway, setSelectedGateway] = useState("healthcare-tool-gateway")
  const [availableTools, setAvailableTools] = useState<GatewayTool[]>([])
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [toolsExpanded, setToolsExpanded] = useState(false)

  const [agentBehaviorTab, setAgentBehaviorTab] = useState<"settings" | "prompts">("settings")

  const [message, setMessage] = useState("")
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    const loadTools = async () => {
      try {
        const res = await getGatewayTools()
        setAvailableGateways(["healthcare-tool-gateway"])
        setSelectedGateway("healthcare-tool-gateway")
        setAvailableTools(res.data.tools || [])
        setSelectedTools((res.data.tools || []).map((t: GatewayTool) => t.name))
      } catch (err: any) {
        console.error(err)
        setMessage(
          `Error loading gateway tools: ${err?.response?.data?.detail || err.message}`
        )
      }
    }

    loadTools()
  }, [])

  const suggestRepoName = async (
    rawValue: string,
    setter: (value: string) => void
  ) => {
    const base = slugify(rawValue)

    if (!base) {
      setter("")
      return
    }

    try {
      const res = await getNextAvailableRepoName(base)
      setter(res.data.suggested || base)
    } catch (err) {
      console.error(err)
      setter(base)
    }
  }

  useEffect(() => {
    if (!repoNameTouched) {
      suggestRepoName(appName, setRepoName)
    }
  }, [appName, repoNameTouched])

  useEffect(() => {
    if (!agentRepoNameTouched) {
      suggestRepoName(agentName, setAgentRepoName)
    }
  }, [agentName, agentRepoNameTouched])

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName]
    )
  }

  const repoExists = async (name: string) => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPPORT_API}/repo-exists?name=${encodeURIComponent(name)}`
      )
      if (!res.ok) return false
      const data = await res.json()
      return !!data.exists
    } catch {
      return false
    }
  }

  const submit = async () => {
    try {
      setMessage("Checking repo names...")
      setResult(null)
  
      if (!repoName || !agentRepoName) {
        setMessage("Error: App repo name and agent repo name are required.")
        return
      }
  
      const appExists = await repoExists(repoName)
      if (appExists) {
        setMessage(`Error: App repo name already exists: ${repoName}`)
        return
      }
  
      const agentExists = await repoExists(agentRepoName)
      if (agentExists) {
        setMessage(`Error: Agent repo name already exists: ${agentRepoName}`)
        return
      }
  
      setMessage("Creating application and agent repos...")
  
      const writeTools = availableTools
        .filter((t) => t.mode === "write" && selectedTools.includes(t.name))
        .map((t) => t.name)
  
      const payload = {
        industry,
        customer_name: customer,
        line_of_business: lob,
        app: {
          repo_name: repoName,
          app_name: appName,
          ui_type: "end_user_ui",
          description,
        },
        agents: [
          {
            agent_name: agentName,
            agent_type: agentType,
            mode: "create_new",
            capabilities: selectedTools,
            create_config: {
              repo_name: agentRepoName,
              usecase_name: usecaseName,
              agent_type: agentType,
              persona,
              tool_policy: {
                mode: "selected",
                allowed_tools: selectedTools,
                allowed_tags: [],
              },
              rag: {
                enabled: localRagEnabled,
                top_k: Number(localTopK),
                score_threshold: Number(localScoreThreshold),
              },
              model: {
                provider: "openai",
                model: modelName,
                temperature: Number(temperature),
              },
              approval: {
                enabled: localHumanReviewEnabled,
                write_tools: localHumanReviewEnabled ? writeTools : [],
              },
              memory: {
                enabled: localMemoryEnabled,
                thread: localThreadMemory,
                case: localCaseMemory,
                long_term: false,
              },
              embeddings: {
                provider: "openai",
                model: "text-embedding-3-small",
              },
              chunking: {
                strategy: "fixed",
                chunk_size: 500,
                chunk_overlap: 100,
              },
              document_ingestion: {
                enabled: true,
                upload_via_ui: true,
                allowed_types: ["txt", "pdf", "docx"],
                auto_embed_on_upload: true,
              },
              prompts: {
                planner_system_prompt: plannerPrompt,
                responder_system_prompt: responderPrompt,
              },
            },
          },
        ],
      }
  
      const createRes = await createApplication(payload)
  
      if (!createRes?.data?.ok) {
        throw new Error(createRes?.data?.error || "create-application failed")
      }
  
      const createdAppRepo = createRes.data.app_repo_name || repoName
      const createdAgentRepo = createRes.data.agents?.[0]?.repo_name || agentRepoName
  
      setMessage("Starting workspace...")
  
      const workspaceRes = await startWorkspace(createdAgentRepo, createdAppRepo)
  
      setResult({
        ...(createRes.data || {}),
        workspace: workspaceRes.data,
        workspace_urls: workspaceRes.data?.urls,
        selected_gateway: selectedGateway,
        local_profile: {
          human_review: localHumanReviewEnabled,
          memory: {
            enabled: localMemoryEnabled,
            scopes: {
              thread: localThreadMemory,
              case: localCaseMemory,
            },
          },
          rag: {
            enabled: localRagEnabled,
            rag_type: localRagType,
            top_k: localTopK,
            score_threshold: localScoreThreshold,
          },
        },
        agentcore_profile: {
          teaser_only: true,
          enabled: agentCoreEnabled,
          human_review: agentCoreHumanReviewEnabled,
          memory: {
            enabled: agentCoreMemoryEnabled,
            scopes: {
              thread: agentCoreThreadMemory,
              case: agentCoreCaseMemory,
            },
          },
          rag: {
            enabled: agentCoreRagEnabled,
            rag_type: agentCoreRagType,
            top_k: agentCoreTopK,
            score_threshold: agentCoreScoreThreshold,
          },
        },
      })
  
      setMessage("Application and agent generated successfully.")
    } catch (err: any) {
      console.error(err)
      setResult(null)
      setMessage(
        `Error: ${err?.response?.data?.error || err?.response?.data?.detail || err.message}`
      )
    }
  }
  const pageStyle: CSSProperties = {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: 20,
    fontFamily: "Arial, sans-serif",
    color: "#111827",
  }

  const containerStyle: CSSProperties = {
    maxWidth: 1680,
    margin: "0 auto",
  }

  const sectionStyle: CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d0d7de",
    fontSize: 14,
    boxSizing: "border-box",
  }

  const readonlyInputStyle: CSSProperties = {
    ...inputStyle,
    background: "#f9fafb",
    color: "#6b7280",
  }

  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 6,
    color: "#374151",
  }

  const compactGrid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
  }

  const pillButton = (active: boolean): CSSProperties => ({
    padding: "8px 12px",
    borderRadius: 999,
    border: active ? "1px solid #2563eb" : "1px solid #d1d5db",
    background: active ? "#eff6ff" : "#ffffff",
    color: active ? "#1d4ed8" : "#374151",
    fontWeight: 600,
    cursor: "pointer",
  })

  const profileCardStyle = (grayedOut = false): CSSProperties => ({
    border: "1px solid #d1d5db",
    borderRadius: 12,
    padding: 16,
    background: grayedOut ? "#f9fafb" : "#eff6ff",
    opacity: grayedOut ? 0.55 : 1,
    filter: grayedOut ? "grayscale(0.2)" : "none",
    pointerEvents: grayedOut ? "none" : "auto",
  })

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 30 }}>Agent Factory</h1>
          <p style={{ marginTop: 8, color: "#4b5563" }}>
            Configure one application, one agent, select a gateway and tools, and prepare a local working profile with an AgentCore teaser profile.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.45fr 0.95fr",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 18 }}>
            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 12 }}>Basic Information</h2>
              <div style={compactGrid}>
                <div>
                  <label style={labelStyle}>Industry</label>
                  <input
                    style={inputStyle}
                    placeholder="healthcare"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Customer Name</label>
                  <input
                    style={inputStyle}
                    placeholder="Centene"
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Line of Business</label>
                  <input
                    style={inputStyle}
                    placeholder="Medicaid"
                    value={lob}
                    onChange={(e) => setLob(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Application Name</label>
                  <input
                    style={inputStyle}
                    placeholder="CM Capability App V20"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>App Repo Name</label>
                  <input
                    style={inputStyle}
                    placeholder="cm-capability-app-v20"
                    value={repoName}
                    onChange={(e) => {
                      setRepoNameTouched(true)
                      setRepoName(e.target.value)
                    }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>App Template Used</label>
                  <input style={readonlyInputStyle} value="app-template" readOnly />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Description</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 68 }}
                  placeholder="Care management application for Medicaid"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 12 }}>Agent Definition</h2>
              <div style={compactGrid}>
                <div>
                  <label style={labelStyle}>Agent Name</label>
                  <input
                    style={inputStyle}
                    placeholder="CM Chat Agent Capability V20"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Agent Repo Name</label>
                  <input
                    style={inputStyle}
                    placeholder="cm-chat-agent-capability-v20"
                    value={agentRepoName}
                    onChange={(e) => {
                      setAgentRepoNameTouched(true)
                      setAgentRepoName(e.target.value)
                    }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Agent Type</label>
                  <select
                    style={inputStyle}
                    value={agentType}
                    onChange={(e) => setAgentType(e.target.value)}
                  >
                    {AGENT_TYPE_OPTIONS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={!option.enabled}
                      >
                        {option.label}{option.enabled ? "" : " (coming soon)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Persona</label>
                  <input
                    style={inputStyle}
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Use Case Name</label>
                  <input
                    style={inputStyle}
                    value={usecaseName}
                    onChange={(e) => setUsecaseName(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Model</label>
                  <select
                    style={inputStyle}
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                  >
                    {MODEL_OPTIONS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={!option.enabled}
                      >
                        {option.label}{option.enabled ? "" : " (coming soon)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Temperature</label>
                  <input
                    style={inputStyle}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Agent Template Used</label>
                  <input
                    style={readonlyInputStyle}
                    value="chat-agent-template"
                    readOnly
                  />
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ margin: 0 }}>Gateway & Tools</h2>
                <button
                  type="button"
                  onClick={() => setToolsExpanded(!toolsExpanded)}
                  style={pillButton(false)}
                >
                  {toolsExpanded ? "Hide Tools" : "Show Tools"} ({selectedTools.length}/{availableTools.length})
                </button>
              </div>

              <div style={compactGrid}>
                <div>
                  <label style={labelStyle}>Select Gateway</label>
                  <select
                    style={inputStyle}
                    value={selectedGateway}
                    onChange={(e) => setSelectedGateway(e.target.value)}
                  >
                    {availableGateways.map((gateway) => (
                      <option key={gateway} value={gateway}>
                        {gateway}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Gateway Status</label>
                  <input style={readonlyInputStyle} value="Published" readOnly />
                </div>
              </div>

              {toolsExpanded && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                    marginTop: 14,
                  }}
                >
                  {availableTools.map((tool) => (
                    <label
                      key={tool.name}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: 12,
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        background: "#fafafa",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTools.includes(tool.name)}
                        onChange={() => toggleTool(tool.name)}
                        style={{ marginTop: 2 }}
                      />
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {tool.name}{" "}
                          <span style={{ color: "#6b7280", fontWeight: 400 }}>
                            ({tool.mode})
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: "#4b5563" }}>
                          {tool.description || "No description"}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div style={sectionStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ margin: 0 }}>Agent Behavior</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setAgentBehaviorTab("settings")}
                    style={pillButton(agentBehaviorTab === "settings")}
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgentBehaviorTab("prompts")}
                    style={pillButton(agentBehaviorTab === "prompts")}
                  >
                    Prompts
                  </button>
                </div>
              </div>

              {agentBehaviorTab === "settings" && (
                <div style={compactGrid}>
                  <div>
                    <label style={labelStyle}>Model</label>
                    <select
                      style={inputStyle}
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={!option.enabled}
                        >
                          {option.label}{option.enabled ? "" : " (coming soon)"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Temperature</label>
                    <input
                      style={inputStyle}
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Persona</label>
                    <input
                      style={inputStyle}
                      value={persona}
                      onChange={(e) => setPersona(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Use Case Name</label>
                    <input
                      style={inputStyle}
                      value={usecaseName}
                      onChange={(e) => setUsecaseName(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {agentBehaviorTab === "prompts" && (
                <div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Tool Planning Instructions</label>
                    <textarea
                      style={{ ...inputStyle, minHeight: 72 }}
                      value={plannerPrompt}
                      onChange={(e) => setPlannerPrompt(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Response Instructions</label>
                    <textarea
                      style={{ ...inputStyle, minHeight: 72 }}
                      value={responderPrompt}
                      onChange={(e) => setResponderPrompt(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: 18, position: "sticky", top: 16 }}>
            <div style={sectionStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ margin: 0 }}>Deployment Profiles</h2>
                <button
                  type="button"
                  onClick={() => setShowAgentCoreProfile(!showAgentCoreProfile)}
                  style={pillButton(false)}
                >
                  {showAgentCoreProfile ? "Hide AgentCore" : "Show AgentCore"}
                </button>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                <div style={profileCardStyle(false)}>
                  <div style={{ marginBottom: 10 }}>
                    <strong>Local Profile</strong>
                    <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>
                      This profile is active and drives the current generated repo configuration.
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ fontSize: 14 }}>Human Review</strong>
                    <div style={{ marginTop: 8 }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={localHumanReviewEnabled}
                          onChange={(e) => setLocalHumanReviewEnabled(e.target.checked)}
                        />{" "}
                        Require human review for selected write tools
                      </label>
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ fontSize: 14 }}>Memory</strong>
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={localMemoryEnabled}
                          onChange={(e) => setLocalMemoryEnabled(e.target.checked)}
                        />{" "}
                        Enable Memory
                      </label>

                      {localMemoryEnabled && (
                        <div style={{ paddingLeft: 18, display: "grid", gap: 8 }}>
                          <label>
                            <input
                              type="checkbox"
                              checked={localThreadMemory}
                              onChange={(e) => setLocalThreadMemory(e.target.checked)}
                            />{" "}
                            Memory Scope: Thread
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={localCaseMemory}
                              onChange={(e) => setLocalCaseMemory(e.target.checked)}
                            />{" "}
                            Memory Scope: Case
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <strong style={{ fontSize: 14 }}>RAG</strong>
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={localRagEnabled}
                          onChange={(e) => setLocalRagEnabled(e.target.checked)}
                        />{" "}
                        Enable RAG
                      </label>

                      {localRagEnabled && (
                        <div style={{ display: "grid", gap: 10, paddingTop: 4 }}>
                          <div>
                            <label style={labelStyle}>RAG Type</label>
                            <select
                              style={inputStyle}
                              value={localRagType}
                              onChange={(e) => setLocalRagType(e.target.value)}
                            >
                              <option value="none">None</option>
                              <option value="vector_rag">Vector RAG</option>
                              <option value="hybrid_rag">Hybrid RAG (teaser)</option>
                              <option value="graph_rag">Graph RAG (teaser)</option>
                              <option value="sql_rag">Structured / SQL RAG (teaser)</option>
                            </select>
                          </div>

                          <div style={compactGrid}>
                            <div>
                              <label style={labelStyle}>Top K</label>
                              <input
                                style={inputStyle}
                                value={localTopK}
                                onChange={(e) => setLocalTopK(e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={labelStyle}>Score Threshold</label>
                              <input
                                style={inputStyle}
                                value={localScoreThreshold}
                                onChange={(e) => setLocalScoreThreshold(e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {showAgentCoreProfile && (
                  <div style={profileCardStyle(true)}>
                    <div style={{ marginBottom: 10 }}>
                      <strong>AgentCore Profile</strong>
                      <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>
                        Teaser only for now. Visible for platform direction, not wired into generation or deployment yet.
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ fontSize: 14 }}>Human Review</strong>
                      <div style={{ marginTop: 8 }}>
                        <label>
                          <input type="checkbox" checked={agentCoreHumanReviewEnabled} readOnly /> Require human review for selected write tools
                        </label>
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ fontSize: 14 }}>Memory</strong>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        <label>
                          <input type="checkbox" checked={agentCoreMemoryEnabled} readOnly /> Enable Memory
                        </label>

                        {agentCoreMemoryEnabled && (
                          <div style={{ paddingLeft: 18, display: "grid", gap: 8 }}>
                            <label>
                              <input type="checkbox" checked={agentCoreThreadMemory} readOnly /> Memory Scope: Thread
                            </label>
                            <label>
                              <input type="checkbox" checked={agentCoreCaseMemory} readOnly /> Memory Scope: Case
                            </label>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <strong style={{ fontSize: 14 }}>RAG</strong>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        <label>
                          <input type="checkbox" checked={agentCoreRagEnabled} readOnly /> Enable RAG
                        </label>

                        {agentCoreRagEnabled && (
                          <div style={{ display: "grid", gap: 10, paddingTop: 4 }}>
                            <div>
                              <label style={labelStyle}>RAG Type</label>
                              <input style={readonlyInputStyle} value={agentCoreRagType} readOnly />
                            </div>

                            <div style={compactGrid}>
                              <div>
                                <label style={labelStyle}>Top K</label>
                                <input style={readonlyInputStyle} value={agentCoreTopK} readOnly />
                              </div>
                              <div>
                                <label style={labelStyle}>Score Threshold</label>
                                <input style={readonlyInputStyle} value={agentCoreScoreThreshold} readOnly />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={sectionStyle}>
              <button
                onClick={submit}
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "#2563eb",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 15,
                }}
              >
                Generate Application + Agent
              </button>

              <div
                style={{
                  marginTop: 14,
                  color: message.startsWith("Error") ? "#b91c1c" : "#374151",
                  fontSize: 14,
                }}
              >
                {message}
              </div>
            </div>

            {result && (
              <div style={sectionStyle}>
                <h2 style={{ marginTop: 0, marginBottom: 12 }}>Generation Result</h2>
                <div><strong>Status:</strong> {result.status}</div>
                <div><strong>Gateway:</strong> {result.selected_gateway}</div>
                <div><strong>Industry:</strong> {result.industry}</div>
                <div><strong>Customer:</strong> {result.customer_name}</div>
                <div><strong>LOB:</strong> {result.line_of_business}</div>
                <div><strong>App Repo:</strong> {result.app_repo_name}</div>
                <div><strong>App Path:</strong> {result.app_repo_url}</div>
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                <div><strong>Infra Started:</strong> {String(result.workspace?.infra?.ok)}</div>
                <div><strong>Runtime Started:</strong> {String(result.workspace?.runtime?.ok)}</div>
                <div><strong>App Started:</strong> {String(result.workspace?.app?.ok)}</div>
              </div>

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>

              <div style={{ marginBottom: 12 }}>
                <strong>App UI</strong>
                <div>
                  <a href={result.workspace_urls?.app_ui_url} target="_blank" rel="noreferrer">
                    {result.workspace_urls?.app_ui_url}
                  </a>
                </div>
                <div>
                  Launch:{" "}
                  <a
                    href={result.workspace_urls?.app_ui_url ? `${result.workspace_urls.app_ui_url}/nurse` : "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.workspace_urls?.app_ui_url ? `${result.workspace_urls.app_ui_url}/nurse` : ""}
                  </a>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <strong>Agent Runtime</strong>
                <div>
                  <a href={result.workspace_urls?.agent_runtime_url} target="_blank" rel="noreferrer">
                    {result.workspace_urls?.agent_runtime_url}
                  </a>
                </div>
                <div>
                  Docs:{" "}
                  <a
                    href={result.workspace_urls?.agent_runtime_url ? `${result.workspace_urls.agent_runtime_url}/docs` : "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.workspace_urls?.agent_runtime_url ? `${result.workspace_urls.agent_runtime_url}/docs` : ""}
                  </a>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <strong>Tool Gateway</strong>
                <div>
                  <a href={result.workspace_urls?.tool_gateway_url} target="_blank" rel="noreferrer">
                    {result.workspace_urls?.tool_gateway_url}
                  </a>
                </div>
                <div>
                  Tools:{" "}
                  <a
                    href={result.workspace_urls?.tool_gateway_url ? `${result.workspace_urls.tool_gateway_url}/tools/specs` : "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.workspace_urls?.tool_gateway_url ? `${result.workspace_urls.tool_gateway_url}/tools/specs` : ""}
                  </a>
                </div>
              </div>

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                <div><strong>Requested Runtime Port:</strong> {result.workspace?.ports?.requested_runtime_port}</div>
                <div><strong>Resolved Runtime Port:</strong> {result.workspace?.ports?.resolved_runtime_port}</div>
                <div><strong>Requested App Port:</strong> {result.workspace?.ports?.requested_app_port}</div>
                <div><strong>Resolved App Port:</strong> {result.workspace?.ports?.resolved_app_port}</div>
              </div>

              </div>

                {result.agents?.map((agent: any) => (
                  <div
                    key={agent.repo_name || agent.agent_name}
                    style={{
                      marginTop: 16,
                      paddingTop: 16,
                      borderTop: "1px solid #e5e7eb",
                    }}
                  >
                    <div><strong>Agent Name:</strong> {agent.agent_name}</div>
                    <div><strong>Agent Type:</strong> {agent.agent_type}</div>
                    <div><strong>Agent Repo:</strong> {agent.repo_name}</div>
                    <div><strong>Agent Path:</strong> {agent.repo_url}</div>
                    <div><strong>Agent Status:</strong> {agent.status}</div>
                  </div>
                ))}

                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                  <div><strong>Local Profile:</strong> wired</div>
                  <div><strong>AgentCore Profile:</strong> teaser only</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}