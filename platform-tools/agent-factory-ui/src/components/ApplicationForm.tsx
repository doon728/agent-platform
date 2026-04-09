import { useEffect, useState, type CSSProperties } from "react"
import {
  createApplication,
  getGatewayTools,
  getNextAvailableRepoName,
  startWorkspace,
  getWorkspaceStatus,
  getFilesystemCapabilities,
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
  // ── Available ────────────────────────────────────────────────────────────────
  { value: "chat_agent",            label: "chat_agent — simple (linear planner)",       enabled: true },
  { value: "summarization_agent",   label: "summarization_agent",                        enabled: true },
  // ── Roadmap: reasoning strategy variants ─────────────────────────────────────
  { value: "chat_agent_react",      label: "chat_agent — ReAct (think→act→observe loop)", enabled: false },
  { value: "chat_agent_cot",        label: "chat_agent — Chain-of-Thought",               enabled: false },
  { value: "chat_agent_self_corrective", label: "chat_agent — Self-Corrective (grade→retry)", enabled: false },
  { value: "chat_agent_reflection", label: "chat_agent — Reflection",                    enabled: false },
  { value: "chat_agent_plan_execute", label: "chat_agent — Plan & Execute",              enabled: false },
  { value: "workflow_agent",        label: "workflow_agent — simple",                    enabled: false },
  { value: "workflow_agent_react",  label: "workflow_agent — ReAct",                     enabled: false },
  { value: "multi_agent",           label: "multi_agent — supervisor",                   enabled: false },
  { value: "multi_agent_hitl",      label: "multi_agent — supervisor + HITL",            enabled: false },
]


export default function ApplicationForm() {
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

  // RAG — planner tool stage (independent config)
  const [localRagEnabled, setLocalRagEnabled] = useState(true)
  const [localPlannerTool, setLocalPlannerTool] = useState("search_kb")
  const [localPlannerStrategy, setLocalPlannerStrategy] = useState("semantic")
  const [localPlannerPattern, setLocalPlannerPattern] = useState("naive")
  const [localTopK, setLocalTopK] = useState("5")
  const [localScoreThreshold, setLocalScoreThreshold] = useState("0.35")
  // RAG — pre-graph stage (independent config)
  const [localPreGraphEnabled, setLocalPreGraphEnabled] = useState(false)
  const [localPreGraphTool, setLocalPreGraphTool] = useState("search_kb")
  const [localPreGraphStrategy, setLocalPreGraphStrategy] = useState("hybrid")
  const [localPreGraphPattern, setLocalPreGraphPattern] = useState("naive")
  const [localPreGraphTopK, setLocalPreGraphTopK] = useState("3")
  const [localPreGraphThreshold, setLocalPreGraphThreshold] = useState("0.5")



  // Tools
  const [availableGateways] = useState<string[]>(["healthcare-tool-gateway"])
  const [selectedGateway, setSelectedGateway] = useState("healthcare-tool-gateway")
  const [availableTools, setAvailableTools] = useState<GatewayTool[]>([])
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [toolsExpanded, setToolsExpanded] = useState(false)

  // Template manifest
  const [_templateManifest, setTemplateManifest] = useState<any>(null)

  // Data from filesystem
  const [filesystemCapabilities, setFilesystemCapabilities] = useState<string[]>([])

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
        if (firstRetrievalTool) { setLocalPlannerTool(firstRetrievalTool.name); setLocalPreGraphTool(firstRetrievalTool.name) }
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
              pre_graph: {
                enabled: localPreGraphEnabled,
                tool: localPreGraphTool,
                strategy: localPreGraphStrategy,
                pattern: localPreGraphPattern,
                top_k: Number(localPreGraphTopK),
                similarity_threshold: Number(localPreGraphThreshold),
              },
              planner_tool: {
                enabled: localRagEnabled,
                tool: localPlannerTool,
                strategy: localPlannerStrategy,
                pattern: localPlannerPattern,
                top_k: Number(localTopK),
                similarity_threshold: Number(localScoreThreshold),
                fallback: { allow_no_results_response: true },
              },
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
            prompts: {},
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
  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30 }}>Agent Factory</h1>
        <p style={{ marginTop: 8, color: "#4b5563" }}>
          Select an existing capability and scaffold a new agent under it. Configure existing agents in Agent Registry.
        </p>
      </div>

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

                <div>
                  <label style={labelStyle}>Temperature</label>
                  <input style={inputStyle} value={temperature} onChange={(e) => setTemperature(e.target.value)} />
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

            {/* Memory */}
            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 12 }}>Memory</h2>
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
            </div>
          </div>

          {/* Right */}
          <div style={{ display: "grid", gap: 18, position: "sticky", top: 16 }}>
            {/* HITL */}
            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 12 }}>HITL (Human-in-the-Loop)</h2>
              {agentType === "summarization_agent" ? (
                <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.2)", color: "#64748b", fontSize: 12 }}>
                  Not applicable — summarization agents are read-only.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
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
            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, marginBottom: 4 }}>RAG Configuration</h2>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>Each stage has independent Dim 1 (strategy), Dim 2 (stage), and Dim 3 (pattern) config.</div>

              {/* Stage 1 — Pre-Graph */}
              <div style={{ border: `1px solid ${localPreGraphEnabled ? "#c4b5fd" : "#e5e7eb"}`, borderRadius: 8, padding: 14, marginBottom: 12, opacity: localPreGraphEnabled ? 1 : 0.7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Pre-Graph RAG</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", background: "#dbeafe", padding: "2px 7px", borderRadius: 4 }}>Dim 1: Strategy</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#5b21b6", background: "#ede9fe", padding: "2px 7px", borderRadius: 4 }}>Dim 2: Stage 1 (Pre-Graph)</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fef3c7", padding: "2px 7px", borderRadius: 4 }}>Dim 3: Pattern</span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10 }}>Ambient enrichment before planner. Best for: chat_agent, workflow_agent.</div>
                <label style={{ fontSize: 13, display: "block", marginBottom: 10 }}>
                  <input type="checkbox" checked={localPreGraphEnabled} onChange={e => setLocalPreGraphEnabled(e.target.checked)} />{" "}Enable Pre-Graph RAG
                </label>
                <div style={{ display: "grid", gap: 8, opacity: localPreGraphEnabled ? 1 : 0.45 }}>
                  <div style={compactGrid}>
                    <div>
                      <label style={labelStyle}>KB Tool</label>
                      <select style={inputStyle} disabled={!localPreGraphEnabled} value={localPreGraphTool} onChange={e => setLocalPreGraphTool(e.target.value)}>
                        {availableTools.filter(t => !!t.db_type).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                        {availableTools.filter(t => !!t.db_type).length === 0 && <option value="search_kb">search_kb</option>}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Strategy (Dim 1)</label>
                      <select style={inputStyle} disabled={!localPreGraphEnabled} value={localPreGraphStrategy} onChange={e => setLocalPreGraphStrategy(e.target.value)}>
                        <option value="semantic">Semantic</option>
                        <option value="keyword">Keyword</option>
                        <option value="hybrid">Hybrid (RRF)</option>
                        <option value="graph" disabled>Graph RAG — roadmap</option>
                      </select>
                    </div>
                  </div>
                  <div style={compactGrid}>
                    <div>
                      <label style={labelStyle}>Pattern (Dim 3)</label>
                      <select style={inputStyle} disabled={!localPreGraphEnabled} value={localPreGraphPattern} onChange={e => setLocalPreGraphPattern(e.target.value)}>
                        <option value="naive">Naive</option>
                        <option value="self_corrective">Self-Corrective</option>
                        <option value="multi_hop" disabled>Multi-Hop — roadmap</option>
                        <option value="hyde" disabled>HyDE — roadmap</option>
                        <option value="agentic" disabled>Agentic — roadmap</option>
                      </select>
                    </div>
                    <div><label style={labelStyle}>Top K</label><input style={inputStyle} disabled={!localPreGraphEnabled} value={localPreGraphTopK} onChange={e => setLocalPreGraphTopK(e.target.value)} /></div>
                    <div><label style={labelStyle}>Threshold</label><input style={inputStyle} disabled={!localPreGraphEnabled} value={localPreGraphThreshold} onChange={e => setLocalPreGraphThreshold(e.target.value)} /></div>
                  </div>
                </div>
              </div>

              {/* Stage 2 — Planner Tool */}
              <div style={{ border: `1px solid ${localRagEnabled ? "#86efac" : "#e5e7eb"}`, borderRadius: 8, padding: 14, opacity: localRagEnabled ? 1 : 0.7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Planner Tool RAG</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", background: "#dbeafe", padding: "2px 7px", borderRadius: 4 }}>Dim 1: Strategy</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#166534", background: "#dcfce7", padding: "2px 7px", borderRadius: 4 }}>Dim 2: Stage 2 (Planner Tool)</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fef3c7", padding: "2px 7px", borderRadius: 4 }}>Dim 3: Pattern</span>
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10 }}>LLM calls KB explicitly via tool. Best for: chat_agent, react_agent.</div>
                <label style={{ fontSize: 13, display: "block", marginBottom: 10 }}>
                  <input type="checkbox" checked={localRagEnabled} onChange={e => setLocalRagEnabled(e.target.checked)} />{" "}Enable Planner Tool RAG
                </label>
                <div style={{ display: "grid", gap: 8, opacity: localRagEnabled ? 1 : 0.45 }}>
                  <div style={compactGrid}>
                    <div>
                      <label style={labelStyle}>KB Tool</label>
                      <select style={inputStyle} disabled={!localRagEnabled} value={localPlannerTool} onChange={e => setLocalPlannerTool(e.target.value)}>
                        {availableTools.filter(t => !!t.db_type).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                        {availableTools.filter(t => !!t.db_type).length === 0 && <option value="search_kb">search_kb</option>}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Strategy (Dim 1)</label>
                      <select style={inputStyle} disabled={!localRagEnabled} value={localPlannerStrategy} onChange={e => setLocalPlannerStrategy(e.target.value)}>
                        <option value="semantic">Semantic</option>
                        <option value="keyword">Keyword</option>
                        <option value="hybrid">Hybrid (RRF)</option>
                        <option value="graph" disabled>Graph RAG — roadmap</option>
                      </select>
                    </div>
                  </div>
                  <div style={compactGrid}>
                    <div>
                      <label style={labelStyle}>Pattern (Dim 3)</label>
                      <select style={inputStyle} disabled={!localRagEnabled} value={localPlannerPattern} onChange={e => setLocalPlannerPattern(e.target.value)}>
                        <option value="naive">Naive</option>
                        <option value="self_corrective">Self-Corrective</option>
                        <option value="multi_hop" disabled>Multi-Hop — roadmap</option>
                        <option value="hyde" disabled>HyDE — roadmap</option>
                        <option value="agentic" disabled>Agentic — roadmap</option>
                      </select>
                    </div>
                    <div><label style={labelStyle}>Top K</label><input style={inputStyle} disabled={!localRagEnabled} value={localTopK} onChange={e => setLocalTopK(e.target.value)} /></div>
                    <div><label style={labelStyle}>Threshold</label><input style={inputStyle} disabled={!localRagEnabled} value={localScoreThreshold} onChange={e => setLocalScoreThreshold(e.target.value)} /></div>
                  </div>
                </div>
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
    </div>
  )
}
