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
  { value: "chat_agent_simple",           label: "chat_agent — simple (linear planner)",       enabled: true },
  { value: "summarization_agent_simple", label: "summarization_agent — simple",               enabled: true },
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
  const [agentType, setAgentType] = useState("chat_agent_simple")
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
            display_name: agentName,
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
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Create Agent</h1>
        <p style={{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
          Pick a capability, agent type, and give it a name. All other configuration (Memory, HITL, RAG, Tools) is done in Agent Registry after scaffold.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "480px 1fr", gap: 24, alignItems: "start", maxWidth: 900 }}>

        {/* ── Left: 3-field form ── */}
        <div style={{ display: "grid", gap: 16 }}>
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Agent Identity</h2>

            <div style={{ display: "grid", gap: 14 }}>

              {/* Capability */}
              <div>
                <label style={labelStyle}>Capability</label>
                <select style={inputStyle} value={capabilityName} onChange={(e) => setCapabilityName(e.target.value)}>
                  <option value="">Select capability…</option>
                  {filesystemCapabilities.map((cap) => (
                    <option key={cap} value={cap}>{cap}</option>
                  ))}
                </select>
                {filesystemCapabilities.length === 0 && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>No capabilities found — create a folder under capabilities/ first.</div>
                )}
              </div>

              {/* Agent Type */}
              <div>
                <label style={labelStyle}>Agent Type</label>
                <select style={inputStyle} value={agentType} onChange={(e) => { setAgentType(e.target.value); applyMemoryDefaults(e.target.value) }}>
                  {BASE_AGENT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} disabled={!o.enabled}>
                      {o.label}{o.enabled ? "" : " (coming soon)"}
                    </option>
                  ))}
                </select>
              </div>

              {/* Display Name */}
              <div>
                <label style={labelStyle}>
                  Display Name{" "}
                  <InfoTooltip text="Business-facing name shown in Agent Registry. Example: 'Pre-Call Assessment Assistant'" />
                </label>
                <input
                  style={inputStyle}
                  placeholder="e.g. Pre-Call Assessment Assistant"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
              </div>

              {/* Agent ID — auto-slugified, editable */}
              <div>
                <label style={labelStyle}>
                  Agent ID / Folder{" "}
                  <InfoTooltip text="Technical ID — auto-generated from Display Name as a slug. Becomes the folder name and usecase_name in config." />
                </label>
                <input
                  style={agentFolderTouched ? inputStyle : { ...inputStyle, color: "#6b7280" }}
                  placeholder="pre-call-assessment"
                  value={agentFolder}
                  onChange={(e) => { setAgentFolderTouched(true); setAgentFolder(e.target.value) }}
                />
              </div>

              {/* Description (optional) */}
              <div>
                <label style={labelStyle}>Description <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
                <textarea
                  style={{ ...inputStyle, minHeight: 56, resize: "vertical" }}
                  placeholder="What does this agent do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Scaffold button */}
          <button
            onClick={handleScaffoldAgent}
            style={{ width: "100%", padding: "13px 18px", borderRadius: 10, border: "none", background: "#2563eb", color: "white", fontWeight: 700, cursor: "pointer", fontSize: 15 }}
          >
            Create Agent →
          </button>

          {message && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: message.startsWith("Error") ? "#fef2f2" : "#f0fdf4", border: `1px solid ${message.startsWith("Error") ? "#fecaca" : "#bbf7d0"}`, color: message.startsWith("Error") ? "#b91c1c" : "#166534", fontSize: 13 }}>
              {message}
            </div>
          )}

          {result && (
            <div style={{ ...sectionStyle, background: "#f0fdf4", borderColor: "#bbf7d0" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#166534", marginBottom: 8 }}>✓ Agent scaffolded</div>
              <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#374151" }}>
                <div><span style={{ color: "#6b7280" }}>Capability:</span> {result.capability_name}</div>
                <div><span style={{ color: "#6b7280" }}>Agent:</span> {result.agent_name}</div>
                <div><span style={{ color: "#6b7280" }}>Folder:</span> {result.agent_repo_name}</div>
              </div>
              <div style={{ marginTop: 12, fontSize: 13, color: "#374151", padding: "8px 12px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6 }}>
                → Go to <strong>Agent Registry</strong> to configure Memory, HITL, RAG, and Tools for this agent.
              </div>
            </div>
          )}
        </div>

        {/* ── Right: what happens next ── */}
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...sectionStyle, background: "#fafafa" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "#374151" }}>What gets created</div>
            <div style={{ display: "grid", gap: 8, fontSize: 13, color: "#4b5563" }}>
              {[
                ["Overlay files", `agents/${capabilityName || "<capability>"}/${agentFolder || "<agent-id>"}/overlays/${agentType}/`],
                ["Config files", "agent.yaml · memory.yaml · prompts.yaml"],
                ["domain.yaml", `copied from capabilities/${capabilityName || "<capability>"}/`],
                ["Registry entry", "usecase_registry.json — agent appears in Agent Registry"],
                ["Workspace", "auto-registered, ready to start from Workspaces"],
              ].map(([label, detail]) => (
                <div key={label} style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: "#22c55e", fontWeight: 700, flexShrink: 0 }}>✓</span>
                  <div>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>{detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...sectionStyle, background: "#fafafa" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "#374151" }}>Configure after scaffold in Agent Registry</div>
            <div style={{ display: "grid", gap: 6, fontSize: 13, color: "#4b5563" }}>
              {[
                ["Memory tab", "Read/write policies, backends, retention, episodic write triggers"],
                ["HITL tab", "Approval gates, risk levels per tool, SLA timeout"],
                ["RAG tab", "Pre-graph & planner tool RAG, strategy, pattern, top-K, threshold"],
                ["Tools tab", "Allowed tool list, access mode"],
                ["Routing tab", "Hard routes — phrase → tool mapping, bypass LLM planner"],
              ].map(([tab, desc]) => (
                <div key={tab} style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: "#f59e0b", fontWeight: 700, flexShrink: 0 }}>→</span>
                  <div>
                    <span style={{ fontWeight: 600 }}>{tab}</span>
                    <span style={{ color: "#9ca3af" }}> — {desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
