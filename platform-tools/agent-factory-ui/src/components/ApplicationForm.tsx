import { useEffect, useState, type CSSProperties } from "react"
import {
  createApplication,
  getGatewayTools,
  getNextAvailableRepoName,
  startWorkspace,
  getWorkspaceStatus,
  getFilesystemCapabilities,
  getFilesystemAgents,
  getTemplateManifest,
} from "../api/factoryApi"

type GatewayTool = {
  name: string
  description?: string
  primary_arg?: string
  mode: string
  tags?: string[]
  db_type?: string
  strategy?: string
}

type FactoryMode = "scaffold_agent" | "configure_agent"

function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <span
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{ cursor: "help", color: "#9ca3af", fontSize: 13, lineHeight: 1, userSelect: "none" }}
      >
        ⓘ
      </span>
      {visible && (
        <span style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#1f2937",
          color: "#f9fafb",
          fontSize: 12,
          lineHeight: 1.5,
          padding: "6px 10px",
          borderRadius: 6,
          whiteSpace: "normal",
          width: 220,
          zIndex: 100,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          pointerEvents: "none",
        }}>
          {text}
        </span>
      )}
    </span>
  )
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

const BASE_AGENT_TYPE_OPTIONS = [
  { value: "chat_agent", label: "chat_agent", enabled: true },
  { value: "summarization_agent", label: "summarization_agent", enabled: true },
  { value: "workflow_agent", label: "workflow_agent", enabled: false },
  { value: "multi_agent", label: "multi_agent", enabled: false },
]

const DEFAULT_PLANNER_PROMPT =
  "You are a care-management agent planner. Your job is to decide which tool should be called next. Only choose from the available tools. Return the next tool call in this format: tool_name: argument"

const DEFAULT_RESPONDER_PROMPT =
  "You are a healthcare care-management assistant helping nurses. Use only the provided tool data or retrieved policy content. Do not invent information. Be concise and clinically useful."

export default function ApplicationForm() {
  const [factoryMode, setFactoryMode] = useState<FactoryMode>("scaffold_agent")

  // Agent identity
  const [capabilityName, setCapabilityName] = useState("")
  const [agentName, setAgentName] = useState("")
  const [agentFolder, setAgentFolder] = useState("")
  const [agentFolderTouched, setAgentFolderTouched] = useState(false)
  const [agentType, setAgentType] = useState("chat_agent")
  const [persona, setPersona] = useState("care_manager")
  const [description, setDescription] = useState("")

  // Model
  const [modelName, setModelName] = useState("gpt-4o-mini")
  const [temperature, setTemperature] = useState("0")

  // Memory
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [memoryTypes, setMemoryTypes] = useState({
    shortTerm: true,
    episodic: true,
    semantic: false,
    summary: true,
  })
  const [memoryAdvanced, setMemoryAdvanced] = useState({
    shortTermWindow: "12",
    summaryInterval: "10",
    episodicTopK: "5",
    semanticTopK: "3",
  })

  // HITL
  const [hitlApprovalRequired, setHitlApprovalRequired] = useState(true)
  const [hitlRiskLevels, setHitlRiskLevels] = useState<Record<string, string>>({ write_case_note: "high" })
  const [hitlMinRisk, setHitlMinRisk] = useState<"high" | "medium_and_above" | "all">("high")
  const [hitlTimeoutMinutes, setHitlTimeoutMinutes] = useState("60")

  // RAG
  const [localRagEnabled, setLocalRagEnabled] = useState(true)
  const [localRagDefaultTool, setLocalRagDefaultTool] = useState("search_kb")
  const [localTopK, setLocalTopK] = useState("3")
  const [localScoreThreshold, setLocalScoreThreshold] = useState("0.35")

  // Prompts
  const [plannerPrompt, setPlannerPrompt] = useState(DEFAULT_PLANNER_PROMPT)
  const [responderPrompt, setResponderPrompt] = useState(DEFAULT_RESPONDER_PROMPT)

  // Tools
  const [availableGateways] = useState<string[]>(["healthcare-tool-gateway"])
  const [selectedGateway, setSelectedGateway] = useState("healthcare-tool-gateway")
  const [availableTools, setAvailableTools] = useState<GatewayTool[]>([])
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [toolsExpanded, setToolsExpanded] = useState(false)

  // Template manifest
  const [templateManifest, setTemplateManifest] = useState<any>(null)

  // AgentCore teaser
  const [showAgentCoreProfile, setShowAgentCoreProfile] = useState(false)
  const [agentBehaviorTab, setAgentBehaviorTab] = useState<"settings" | "memory" | "prompts">("settings")

  // Data from filesystem
  const [filesystemCapabilities, setFilesystemCapabilities] = useState<string[]>([])
  const [filesystemAgents, setFilesystemAgents] = useState<string[]>([])

  // Configure Agent
  const [configureCapability, setConfigureCapability] = useState("")
  const [configureAgent, setConfigureAgent] = useState("")

  // Status
  const [message, setMessage] = useState("")
  const [result, setResult] = useState<any>(null)

  // ── Load initial data ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [toolsRes, capsRes] = await Promise.all([
          getGatewayTools(),
          getFilesystemCapabilities(),
        ])
        const tools: GatewayTool[] = toolsRes.data.tools || []
        setAvailableTools(tools)
        setSelectedTools(tools.map((t) => t.name))
        const firstRetrievalTool = tools.find((t) => !!t.db_type)
        if (firstRetrievalTool) setLocalRagDefaultTool(firstRetrievalTool.name)
        setFilesystemCapabilities(capsRes.data.capabilities || [])
      } catch (err: any) {
        setMessage(`Error loading: ${err?.response?.data?.detail || err.message}`)
      }
    }
    load()
  }, [])

  // ── Auto-slug agent name → folder ─────────────────────────────────────────
  useEffect(() => {
    if (agentFolderTouched) return
    const base = slugify(agentName)
    if (!base) { setAgentFolder(""); return }
    getNextAvailableRepoName(base)
      .then((res) => setAgentFolder(res.data.suggested || base))
      .catch(() => setAgentFolder(base))
  }, [agentName, agentFolderTouched])

  // ── Load filesystem agents when configure capability changes ───────────────
  useEffect(() => {
    if (!configureCapability) { setFilesystemAgents([]); return }
    getFilesystemAgents(configureCapability)
      .then((res) => setFilesystemAgents(res.data.agents || []))
      .catch(() => setFilesystemAgents([]))
  }, [configureCapability])

  // ── Template manifest when agentType changes ───────────────────────────────
  useEffect(() => {
    let cancelled = false
    setTemplateManifest(null)
    getTemplateManifest(agentType)
      .then((res) => { if (!cancelled && res.data?.ok) setTemplateManifest(res.data.manifest) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [agentType])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function buildMemoryPayload() {
    return {
      enabled: memoryEnabled,
      write_policies: {
        conversation: {
          short_term: { enabled: memoryTypes.shortTerm, max_turns: Number(memoryAdvanced.shortTermWindow) },
          summary: { enabled: memoryTypes.summary, interval_turns: Number(memoryAdvanced.summaryInterval) },
        },
        case: { episodic: { enabled: memoryTypes.episodic } },
        member: { semantic: { enabled: memoryTypes.semantic } },
      },
      retrieval_policies: {
        conversation: {
          short_term: { include: memoryTypes.shortTerm, max_turns: Number(memoryAdvanced.shortTermWindow) },
          summary: { include: memoryTypes.summary, max_items: 1 },
        },
        case: { episodic: { include: memoryTypes.episodic, top_k: Number(memoryAdvanced.episodicTopK) } },
        member: { semantic: { include: memoryTypes.semantic, top_k: Number(memoryAdvanced.semanticTopK) } },
      },
    }
  }

  function applyMemoryDefaults(nextAgentType: string) {
    if (nextAgentType === "workflow_agent") {
      setMemoryEnabled(true)
      setMemoryTypes({ shortTerm: false, episodic: true, semantic: false, summary: true })
      setMemoryAdvanced({ shortTermWindow: "8", summaryInterval: "10", episodicTopK: "5", semanticTopK: "3" })
      return
    }
    setMemoryEnabled(true)
    setMemoryTypes({ shortTerm: true, episodic: true, semantic: false, summary: true })
    setMemoryAdvanced({ shortTermWindow: "12", summaryInterval: "10", episodicTopK: "5", semanticTopK: "3" })
  }

  function toggleTool(toolName: string) {
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    )
  }

  const handleScaffoldAgent = async () => {
    try {
      setMessage("")
      setResult(null)

      if (!capabilityName) { setMessage("Error: select a capability."); return }
      if (!agentName || !agentFolder) { setMessage("Error: agent name and folder are required."); return }

      const payload = {
        factory_mode: "scaffold_agent",
        app: {
          repo_name: agentFolder,
          app_name: agentName,
          description,
        },
        agents: [{
          agent_name: agentName,
          agent_type: agentType,
          mode: "create_new",
          capabilities: selectedTools,
          create_config: {
            repo_name: agentFolder,
            capability_name: capabilityName,
            usecase_name: agentFolder,
            agent_type: agentType,
            persona,
            tool_policy: { mode: "selected", allowed_tools: selectedTools, allowed_tags: [] },
            rag: {
              enabled: localRagEnabled,
              default_tool: localRagDefaultTool,
              strategy: availableTools.find((t) => t.name === localRagDefaultTool)?.strategy || "semantic",
              top_k: Number(localTopK),
              score_threshold: Number(localScoreThreshold),
            },
            model: { provider: "openai", model: modelName, temperature: Number(temperature) },
            risk: { approval_required: hitlApprovalRequired, risk_levels: hitlRiskLevels },
            hitl: {
              routing_rules: hitlMinRisk === "all"
                ? [{ risk_level: "low", requires_approval: true }, { risk_level: "medium", requires_approval: true }, { risk_level: "high", requires_approval: true }]
                : hitlMinRisk === "medium_and_above"
                ? [{ risk_level: "medium", requires_approval: true }, { risk_level: "high", requires_approval: true }]
                : [{ risk_level: "high", requires_approval: true }],
              sla: { timeout_minutes: Number(hitlTimeoutMinutes) },
            },
            memory: buildMemoryPayload(),
            embeddings: { provider: "openai", model: "text-embedding-3-small" },
            prompts: { planner_system_prompt: plannerPrompt, responder_system_prompt: responderPrompt },
          },
        }],
      }

      const createRes = await createApplication(payload)
      if (!createRes?.data?.ok) throw new Error(createRes?.data?.error || "scaffold failed")

      const createdAgentRepo = createRes.data.agents?.[0]?.repo_name || agentFolder
      await startWorkspace(createdAgentRepo)
      const statusRes = await getWorkspaceStatus()

      setResult({ ...(createRes.data || {}), workspace: statusRes.data })
      setMessage("Agent scaffolded successfully.")

      // Refresh capability list
      getFilesystemCapabilities().then((r) => setFilesystemCapabilities(r.data.capabilities || []))
    } catch (err: any) {
      setResult(null)
      setMessage(`Error: ${err?.response?.data?.error || err.message}`)
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const pageStyle: CSSProperties = { padding: "28px 32px", fontFamily: "Inter, system-ui, sans-serif", fontSize: 14, color: "#111827", maxWidth: 1200, margin: "0 auto" }
  const sectionStyle: CSSProperties = { background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }
  const labelStyle: CSSProperties = { display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#374151" }
  const inputStyle: CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, outline: "none", boxSizing: "border-box", background: "white", color: "#111827" }
  const readonlyInputStyle: CSSProperties = { ...inputStyle, background: "#f3f4f6", color: "#6b7280", cursor: "default" }
  const compactGrid: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }
  const pillButton = (active: boolean): CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 20,
    border: active ? "1.5px solid #2563eb" : "1.5px solid #d1d5db",
    background: active ? "#eff6ff" : "white",
    color: active ? "#1d4ed8" : "#374151",
    fontSize: 13,
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
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30 }}>Agent Factory</h1>
        <p style={{ marginTop: 8, color: "#4b5563" }}>
          Scaffold new agents under existing capabilities, or configure existing agents.
        </p>
      </div>

      {/* Mode tabs */}
      <div style={{ ...sectionStyle, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Mode</strong>
          <button type="button" onClick={() => { setFactoryMode("scaffold_agent"); setMessage(""); setResult(null) }} style={pillButton(factoryMode === "scaffold_agent")}>
            Scaffold Agent
          </button>
          <button type="button" onClick={() => { setFactoryMode("configure_agent"); setMessage(""); setResult(null) }} style={pillButton(factoryMode === "configure_agent")}>
            Configure Agent
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#4b5563" }}>
          {factoryMode === "scaffold_agent"
            ? "Select an existing capability (created by developer), configure and scaffold a new agent under it."
            : "Select an existing capability and agent to view or update its configuration."}
        </div>
      </div>

      {/* ── Scaffold Agent ── */}
      {factoryMode === "scaffold_agent" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.45fr 0.95fr", gap: 18, alignItems: "start" }}>
          {/* Left */}
          <div style={{ display: "grid", gap: 18 }}>
            {/* Agent Identity */}
            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 12 }}>Agent</h2>
              <div style={compactGrid}>
                <div>
                  <label style={labelStyle}>Capability</label>
                  <select
                    style={inputStyle}
                    value={capabilityName}
                    onChange={(e) => setCapabilityName(e.target.value)}
                  >
                    <option value="">Select capability...</option>
                    {filesystemCapabilities.map((cap) => (
                      <option key={cap} value={cap}>{cap}</option>
                    ))}
                  </select>
                  {filesystemCapabilities.length === 0 && (
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                      No capabilities found. Developer must create capabilities/ directory first.
                    </div>
                  )}
                </div>

                <div>
                  <label style={labelStyle}>Overlay Type</label>
                  <select
                    style={inputStyle}
                    value={agentType}
                    onChange={(e) => { setAgentType(e.target.value); applyMemoryDefaults(e.target.value) }}
                  >
                    {BASE_AGENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} disabled={!o.enabled}>
                        {o.label}{o.enabled ? "" : " (coming soon)"}
                      </option>
                    ))}
                  </select>
                  {templateManifest?.rag_dimension2 && (
                    <div style={{ marginTop: 8, padding: "8px 10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: "#15803d" }}>RAG built-in: </span>
                      <span style={{ fontWeight: 600, color: "#166534" }}>{templateManifest.rag_dimension2.pattern}</span>
                      <span style={{ color: "#4b5563" }}> · {templateManifest.rag_dimension2.description}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label style={labelStyle}>Agent Name</label>
                  <input
                    style={inputStyle}
                    placeholder="Pre-Call Assessment"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </div>

                <div>
                  <label style={labelStyle}>
                    Agent Folder{" "}
                    <InfoTooltip text="Folder name under agents/<capability>/. Auto-generated from agent name — edit to override." />
                  </label>
                  <input
                    style={inputStyle}
                    placeholder="pre-call-assessment"
                    value={agentFolder}
                    onChange={(e) => { setAgentFolderTouched(true); setAgentFolder(e.target.value) }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Persona</label>
                  <input style={inputStyle} value={persona} onChange={(e) => setPersona(e.target.value)} />
                </div>

                <div>
                  <label style={labelStyle}>Model</label>
                  <select style={inputStyle} value={modelName} onChange={(e) => setModelName(e.target.value)}>
                    {MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} disabled={!o.enabled}>
                        {o.label}{o.enabled ? "" : " (coming soon)"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Description</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 60 }}
                  placeholder="What does this agent do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            {/* Gateway & Tools */}
            <div style={sectionStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Gateway & Tools</h2>
                <button type="button" onClick={() => setToolsExpanded(!toolsExpanded)} style={pillButton(false)}>
                  {toolsExpanded ? "Hide Tools" : "Show Tools"} ({selectedTools.length}/{availableTools.length})
                </button>
              </div>
              <div style={compactGrid}>
                <div>
                  <label style={labelStyle}>Select Gateway</label>
                  <select style={inputStyle} value={selectedGateway} onChange={(e) => setSelectedGateway(e.target.value)}>
                    {availableGateways.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Gateway Status</label>
                  <input style={readonlyInputStyle} value="Published" readOnly />
                </div>
              </div>
              {toolsExpanded && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
                  {availableTools.map((tool) => (
                    <label key={tool.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 12, border: "1px solid #e5e7eb", borderRadius: 10, background: "#fafafa" }}>
                      <input type="checkbox" checked={selectedTools.includes(tool.name)} onChange={() => toggleTool(tool.name)} style={{ marginTop: 2 }} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{tool.name} <span style={{ color: "#6b7280", fontWeight: 400 }}>({tool.mode})</span></div>
                        <div style={{ fontSize: 13, color: "#4b5563" }}>{tool.description || "No description"}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Agent Behavior */}
            <div style={sectionStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Agent Behavior</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["settings", "memory", "prompts"] as const).map((tab) => (
                    <button key={tab} type="button" onClick={() => setAgentBehaviorTab(tab)} style={pillButton(agentBehaviorTab === tab)}>
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {agentBehaviorTab === "settings" && (
                <div style={compactGrid}>
                  <div>
                    <label style={labelStyle}>Temperature</label>
                    <input style={inputStyle} value={temperature} onChange={(e) => setTemperature(e.target.value)} />
                  </div>
                </div>
              )}

              {agentBehaviorTab === "memory" && (
                <div style={{ display: "grid", gap: 14 }}>
                  <label style={labelStyle}>
                    <input type="checkbox" checked={memoryEnabled} onChange={(e) => setMemoryEnabled(e.target.checked)} />{" "}
                    Enable Memory
                  </label>
                  {memoryEnabled && (
                    <>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Memory Types</div>
                        <div style={{ display: "grid", gap: 10 }}>
                          {(["shortTerm", "episodic", "semantic", "summary"] as const).map((type) => (
                            <label key={type}>
                              <input type="checkbox" checked={memoryTypes[type]}
                                onChange={(e) => setMemoryTypes((p) => ({ ...p, [type]: e.target.checked }))} />{" "}
                              {type === "shortTerm" ? "Short-Term" : type.charAt(0).toUpperCase() + type.slice(1)} Memory
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Advanced</div>
                        <div style={compactGrid}>
                          <div><label style={labelStyle}>Short-Term Window</label><input style={inputStyle} value={memoryAdvanced.shortTermWindow} onChange={(e) => setMemoryAdvanced((p) => ({ ...p, shortTermWindow: e.target.value }))} /></div>
                          <div><label style={labelStyle}>Summary Interval</label><input style={inputStyle} value={memoryAdvanced.summaryInterval} onChange={(e) => setMemoryAdvanced((p) => ({ ...p, summaryInterval: e.target.value }))} /></div>
                          <div><label style={labelStyle}>Episodic Top-K</label><input style={inputStyle} value={memoryAdvanced.episodicTopK} onChange={(e) => setMemoryAdvanced((p) => ({ ...p, episodicTopK: e.target.value }))} /></div>
                          <div><label style={labelStyle}>Semantic Top-K</label><input style={inputStyle} value={memoryAdvanced.semanticTopK} onChange={(e) => setMemoryAdvanced((p) => ({ ...p, semanticTopK: e.target.value }))} /></div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {agentBehaviorTab === "prompts" && (
                <div style={{ display: "grid", gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Planner System Prompt</label>
                    <textarea style={{ ...inputStyle, minHeight: 90, fontFamily: "monospace", fontSize: 12 }} value={plannerPrompt} onChange={(e) => setPlannerPrompt(e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Responder System Prompt</label>
                    <textarea style={{ ...inputStyle, minHeight: 90, fontFamily: "monospace", fontSize: 12 }} value={responderPrompt} onChange={(e) => setResponderPrompt(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right */}
          <div style={{ display: "grid", gap: 18, position: "sticky", top: 16 }}>
            {/* Deployment Profiles */}
            <div style={sectionStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Deployment Profiles</h2>
                <button type="button" onClick={() => setShowAgentCoreProfile(!showAgentCoreProfile)} style={pillButton(false)}>
                  {showAgentCoreProfile ? "Hide AgentCore" : "Show AgentCore"}
                </button>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {/* Local Profile */}
                <div style={profileCardStyle(false)}>
                  <div style={{ marginBottom: 10 }}>
                    <strong>Local Profile</strong>
                    <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>Active — drives generated agent configuration.</div>
                  </div>

                  {/* HITL */}
                  <div style={{ marginBottom: 16 }}>
                    <strong style={{ fontSize: 14 }}>HITL (Human-in-the-Loop)</strong>
                    {agentType === "summarization_agent" ? (
                      <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.2)", color: "#64748b", fontSize: 12 }}>
                        Not applicable — summarization agents are read-only.
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, display: "grid", gap: 14 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input type="checkbox" checked={hitlApprovalRequired} onChange={(e) => setHitlApprovalRequired(e.target.checked)} />
                          <span style={{ fontWeight: 600, fontSize: 13 }}>Approval Required</span>
                          <InfoTooltip text="When enabled, the agent pauses and waits for human approval before executing any tool that meets the risk threshold." />
                        </label>
                        {hitlApprovalRequired && (
                          <>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                                Risk Level per Tool <InfoTooltip text="Classify how risky each tool call is." />
                              </div>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                  <tr style={{ background: "#f3f4f6" }}>
                                    <th style={{ padding: "5px 8px", textAlign: "left", border: "1px solid #e5e7eb" }}>Tool</th>
                                    <th style={{ padding: "5px 8px", textAlign: "left", border: "1px solid #e5e7eb" }}>Risk</th>
                                    <th style={{ padding: "5px 8px", border: "1px solid #e5e7eb" }}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(hitlRiskLevels).map(([tool, level]) => (
                                    <tr key={tool}>
                                      <td style={{ padding: "5px 8px", border: "1px solid #e5e7eb" }}>
                                        <input style={{ ...inputStyle, padding: "4px 6px" }} value={tool}
                                          onChange={(e) => {
                                            const next: Record<string, string> = {}
                                            Object.entries(hitlRiskLevels).forEach(([k, v]) => { next[k === tool ? e.target.value : k] = v })
                                            setHitlRiskLevels(next)
                                          }} />
                                      </td>
                                      <td style={{ padding: "5px 8px", border: "1px solid #e5e7eb" }}>
                                        <select style={inputStyle} value={level} onChange={(e) => setHitlRiskLevels({ ...hitlRiskLevels, [tool]: e.target.value })}>
                                          <option value="low">low</option>
                                          <option value="medium">medium</option>
                                          <option value="high">high</option>
                                        </select>
                                      </td>
                                      <td style={{ padding: "5px 8px", border: "1px solid #e5e7eb", textAlign: "center" }}>
                                        <button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 14 }}
                                          onClick={() => { const next = { ...hitlRiskLevels }; delete next[tool]; setHitlRiskLevels(next) }}>✕</button>
                                      </td>
                                    </tr>
                                  ))}
                                  <tr>
                                    <td colSpan={3} style={{ padding: "5px 8px", border: "1px solid #e5e7eb" }}>
                                      <button type="button" style={{ ...pillButton(false), fontSize: 12, padding: "4px 10px" }}
                                        onClick={() => setHitlRiskLevels({ ...hitlRiskLevels, new_tool: "low" })}>+ Add Tool</button>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                                Minimum Risk for Approval <InfoTooltip text="Sets the approval threshold." />
                              </div>
                              <select style={inputStyle} value={hitlMinRisk} onChange={(e) => setHitlMinRisk(e.target.value as typeof hitlMinRisk)}>
                                <option value="high">High only</option>
                                <option value="medium_and_above">Medium and above</option>
                                <option value="all">All tool calls</option>
                              </select>
                            </div>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                                SLA Timeout (minutes) <InfoTooltip text="How long before the approval request expires." />
                              </div>
                              <input style={{ ...inputStyle, width: 100 }} value={hitlTimeoutMinutes} onChange={(e) => setHitlTimeoutMinutes(e.target.value)} />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* RAG */}
                  {templateManifest?.rag_dimension2 && (
                    <div>
                      <strong style={{ fontSize: 14 }}>RAG — Dimension 1 (Search Method)</strong>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        <label>
                          <input type="checkbox" checked={localRagEnabled} onChange={(e) => setLocalRagEnabled(e.target.checked)} />{" "}
                          Enable RAG
                        </label>
                        {localRagEnabled && (() => {
                          const retrievalTools = availableTools.filter((t) => !!t.db_type && selectedTools.includes(t.name))
                          if (retrievalTools.length === 0) return <div style={{ fontSize: 12, color: "#6b7280" }}>No retrieval tools selected.</div>
                          return (
                            <div style={{ display: "grid", gap: 10, paddingTop: 4 }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                  <tr style={{ background: "#f3f4f6" }}>
                                    <th style={{ padding: "6px 8px", textAlign: "left", border: "1px solid #e5e7eb" }}>Tool / KB</th>
                                    <th style={{ padding: "6px 8px", textAlign: "left", border: "1px solid #e5e7eb" }}>DB Type</th>
                                    <th style={{ padding: "6px 8px", textAlign: "left", border: "1px solid #e5e7eb" }}>Strategy</th>
                                    <th style={{ padding: "6px 8px", textAlign: "center", border: "1px solid #e5e7eb" }}>Default</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {retrievalTools.map((tool) => (
                                    <tr key={tool.name}>
                                      <td style={{ padding: "6px 8px", border: "1px solid #e5e7eb", fontWeight: 600 }}>{tool.name}</td>
                                      <td style={{ padding: "6px 8px", border: "1px solid #e5e7eb", color: "#4b5563" }}>{tool.db_type || "—"}</td>
                                      <td style={{ padding: "6px 8px", border: "1px solid #e5e7eb" }}>
                                        <span style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "2px 6px", fontSize: 12, fontWeight: 600 }}>
                                          {tool.strategy || "semantic"}
                                        </span>
                                      </td>
                                      <td style={{ padding: "6px 8px", border: "1px solid #e5e7eb", textAlign: "center" }}>
                                        <input type="radio" name="ragDefaultTool" checked={localRagDefaultTool === tool.name} onChange={() => setLocalRagDefaultTool(tool.name)} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div style={compactGrid}>
                                <div><label style={labelStyle}>Top K</label><input style={inputStyle} value={localTopK} onChange={(e) => setLocalTopK(e.target.value)} /></div>
                                <div><label style={labelStyle}>Score Threshold</label><input style={inputStyle} value={localScoreThreshold} onChange={(e) => setLocalScoreThreshold(e.target.value)} /></div>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  )}
                </div>

                {/* AgentCore Profile */}
                {showAgentCoreProfile && (
                  <div style={profileCardStyle(true)}>
                    <strong>AgentCore Profile</strong>
                    <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>Teaser only — coming soon.</div>
                  </div>
                )}
              </div>
            </div>

            {/* Scaffold button */}
            <div style={sectionStyle}>
              <button
                onClick={handleScaffoldAgent}
                style={{ width: "100%", padding: "14px 18px", borderRadius: 10, border: "none", background: "#2563eb", color: "white", fontWeight: 700, cursor: "pointer", fontSize: 15 }}
              >
                Scaffold Agent
              </button>
              <div style={{ marginTop: 14, color: message.startsWith("Error") ? "#b91c1c" : "#374151", fontSize: 14 }}>
                {message}
              </div>
            </div>

            {/* Result */}
            {result && (
              <div style={sectionStyle}>
                <h2 style={{ marginTop: 0, marginBottom: 12 }}>Scaffold Result</h2>
                <div><strong>Status:</strong> {result.status}</div>
                <div><strong>Capability:</strong> {result.capability_name}</div>
                <div><strong>Agent:</strong> {result.agent_name}</div>
                <div><strong>Folder:</strong> {result.agent_repo_name}</div>
                <div><strong>Path:</strong> {result.agent_repo_url}</div>
                {result.workspace && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
                    <div><strong>Workspace:</strong> {result.workspace.status}</div>
                    <div><strong>Agent Runtime:</strong> {result.workspace.agent_runtime_url}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Configure Agent ── */}
      {factoryMode === "configure_agent" && (
        <div style={sectionStyle}>
          <h2 style={{ marginTop: 0, marginBottom: 16 }}>Configure Agent</h2>
          <div style={{ ...compactGrid, maxWidth: 600, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}>Capability</label>
              <select style={inputStyle} value={configureCapability} onChange={(e) => { setConfigureCapability(e.target.value); setConfigureAgent("") }}>
                <option value="">Select capability...</option>
                {filesystemCapabilities.map((cap) => <option key={cap} value={cap}>{cap}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Agent</label>
              <select style={inputStyle} value={configureAgent} onChange={(e) => setConfigureAgent(e.target.value)} disabled={!configureCapability}>
                <option value="">Select agent...</option>
                {filesystemAgents.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          {configureAgent ? (
            <div style={{ padding: "14px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, color: "#166534" }}>
              Selected: <strong>{configureCapability} / {configureAgent}</strong> — full config editing is available in Agent Registry.
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              Select a capability and agent to configure. Full config editing (HITL, RAG, memory, prompts) is in the Agent Registry tab.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
