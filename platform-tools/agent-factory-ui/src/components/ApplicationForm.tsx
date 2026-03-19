import { useEffect, useMemo, useState, type CSSProperties } from "react"
import {
  createApplication,
  createCapability,
  getGatewayTools,
  getNextAvailableRepoName,
  startWorkspace,
  getWorkspaceStatus,
  getUsecaseContract,
  getRegistryCapabilities,
  getRegistryUsecases,
  getRegistryAgents,
  getRegistryAppByCapability,
} from "../api/factoryApi"

type GatewayTool = {
  name: string
  description?: string
  primary_arg?: string
  mode: string
  tags?: string[]
}

type RegistryAgentRecord = {
  agent_type: string
  agent_repo_name: string
  app_repo_name: string
  agent_name: string
  app_name: string
}

type UsecaseMetadata = {
  capability_name: string
  usecase_name: string
  default_agent_type: string
  supported_agent_types: string[]
  components: {
    planner: boolean
    responder: boolean
    workflow: boolean
    router: boolean
  }
  prompt_types: string[]
  features?: {
    memory?: {
      supported: boolean
      configurable: boolean
      default?: boolean
    }
    rag?: {
      supported: boolean
      configurable: boolean
      default?: boolean
    }
    hitl?: {
      supported: boolean
      configurable: boolean
      default?: boolean
    }
    model?: {
      supported: boolean
      configurable: boolean
      default?: string
    }
  }
}

type FactoryMode = "create_capability" | "manage_usecase_agent" | "govern_existing"
type CapabilityCreateMode = "__new__" | string
type UsecaseManageMode = "new" | "existing"

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
  { value: "workflow_agent", label: "workflow_agent", enabled: false },
  { value: "supervisor_agent", label: "supervisor_agent", enabled: false },
  { value: "multi_agent", label: "multi_agent", enabled: false },
  { value: "summarization_agent", label: "summarization_agent", enabled: false },
]

const DEFAULT_PLANNER_PROMPT =
  "You are a care-management agent planner. Your job is to decide which tool should be called next. Only choose from the available tools. Return the next tool call in this format: tool_name: argument"

const DEFAULT_RESPONDER_PROMPT =
  "You are a healthcare care-management assistant helping nurses. Use only the provided tool data or retrieved policy content. Do not invent information. Be concise and clinically useful."

export default function ApplicationForm() {
  const [factoryMode, setFactoryMode] = useState<FactoryMode>("create_capability")

  const [industry, setIndustry] = useState("")
  const [customer, setCustomer] = useState("")
  const [lob, setLob] = useState("")
  const [description, setDescription] = useState("")

  const [capabilityName, setCapabilityName] = useState("")
  const [createCapabilitySelection, setCreateCapabilitySelection] =
    useState<CapabilityCreateMode>("__new__")

  const [appName, setAppName] = useState("")
  const [repoName, setRepoName] = useState("")
  const [repoNameTouched, setRepoNameTouched] = useState(false)

  const [usecaseName, setUsecaseName] = useState("")
  const [manageUsecaseMode, setManageUsecaseMode] = useState<UsecaseManageMode>("new")

  const [agentName, setAgentName] = useState("")
  const [agentRepoName, setAgentRepoName] = useState("")
  const [agentRepoNameTouched, setAgentRepoNameTouched] = useState(false)
  const [agentType, setAgentType] = useState("chat_agent")
  const [persona, setPersona] = useState("care_manager")

  const [plannerPrompt, setPlannerPrompt] = useState(DEFAULT_PLANNER_PROMPT)
  const [responderPrompt, setResponderPrompt] = useState(DEFAULT_RESPONDER_PROMPT)

  const [modelName, setModelName] = useState("gpt-4o-mini")
  const [temperature, setTemperature] = useState("0")

  const [localHumanReviewEnabled, setLocalHumanReviewEnabled] = useState(true)
  const [localMemoryEnabled, setLocalMemoryEnabled] = useState(true)
  const [localThreadMemory, setLocalThreadMemory] = useState(true)
  const [localCaseMemory, setLocalCaseMemory] = useState(true)
  const [localRagEnabled, setLocalRagEnabled] = useState(true)
  const [localRagType, setLocalRagType] = useState("vector_rag")
  const [localTopK, setLocalTopK] = useState("3")
  const [localScoreThreshold, setLocalScoreThreshold] = useState("0.35")

  const [showAgentCoreProfile, setShowAgentCoreProfile] = useState(false)
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

  const [registryCapabilities, setRegistryCapabilities] = useState<string[]>([])
  const [registryUsecases, setRegistryUsecases] = useState<string[]>([])
  const [registryAgents, setRegistryAgents] = useState<RegistryAgentRecord[]>([])

  const [selectedGovernAgentRepo, setSelectedGovernAgentRepo] = useState("")
  const [usecaseMetadata, setUsecaseMetadata] = useState<UsecaseMetadata | null>(null)
  const [metadataMessage, setMetadataMessage] = useState("")

  const createCapabilityExistingSelected =
    factoryMode === "create_capability" && createCapabilitySelection !== "__new__"

  const plannerVisible = useMemo(() => {
    if (factoryMode !== "govern_existing" || !usecaseMetadata) return true
    return !!usecaseMetadata.components?.planner
  }, [factoryMode, usecaseMetadata])

  const responderVisible = useMemo(() => {
    if (factoryMode !== "govern_existing" || !usecaseMetadata) return true
    return !!usecaseMetadata.components?.responder
  }, [factoryMode, usecaseMetadata])

  const agentTypeOptions = useMemo(() => {
    if (
      factoryMode !== "govern_existing" ||
      !usecaseMetadata?.supported_agent_types?.length
    ) {
      return BASE_AGENT_TYPE_OPTIONS
    }

    const supported = new Set(usecaseMetadata.supported_agent_types)
    return BASE_AGENT_TYPE_OPTIONS.map((option) => ({
      ...option,
      enabled: supported.has(option.value),
    }))
  }, [factoryMode, usecaseMetadata])

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [toolsRes, capsRes] = await Promise.all([
          getGatewayTools(),
          getRegistryCapabilities(),
        ])

        setAvailableGateways(["healthcare-tool-gateway"])
        setSelectedGateway("healthcare-tool-gateway")
        setAvailableTools(toolsRes.data.tools || [])
        setSelectedTools((toolsRes.data.tools || []).map((t: GatewayTool) => t.name))
        setRegistryCapabilities(capsRes.data.capabilities || [])
      } catch (err: any) {
        console.error(err)
        setMessage(
          `Error loading initial data: ${err?.response?.data?.detail || err.message}`
        )
      }
    }

    loadInitial()
  }, [])

  useEffect(() => {
    setResult(null)
    setMessage("")
    setUsecaseMetadata(null)

    if (factoryMode === "create_capability") {
      setMetadataMessage("Create a new capability and app shell. If you select an existing capability below, the app fields become readonly and creation is blocked.")
      setCreateCapabilitySelection("__new__")
      setCapabilityName("")
      setAppName("")
      setRepoName("")
      setRepoNameTouched(false)
      setUsecaseName("")
      setAgentName("")
      setAgentRepoName("")
      setAgentRepoNameTouched(false)
      setRegistryUsecases([])
      setRegistryAgents([])
      setSelectedGovernAgentRepo("")
    } else if (factoryMode === "manage_usecase_agent") {
      setMetadataMessage("Select a capability, then either create a new use case + new agent, or select an existing use case and create a new agent under it.")
      setCapabilityName("")
      setAppName("")
      setRepoName("")
      setUsecaseName("")
      setAgentName("")
      setAgentRepoName("")
      setAgentRepoNameTouched(false)
      setManageUsecaseMode("new")
      setRegistryUsecases([])
      setRegistryAgents([])
      setSelectedGovernAgentRepo("")
    } else {
      setMetadataMessage("Select existing capability, use case, and agent to govern prompts and contracts.")
      setCapabilityName("")
      setAppName("")
      setRepoName("")
      setUsecaseName("")
      setAgentName("")
      setAgentRepoName("")
      setRegistryUsecases([])
      setRegistryAgents([])
      setSelectedGovernAgentRepo("")
    }
  }, [factoryMode])

  useEffect(() => {
    if (factoryMode !== "create_capability") return
    if (createCapabilitySelection === "__new__") {
      setCapabilityName("")
      setAppName("")
      setRepoName("")
      setRepoNameTouched(false)
      return
    }

    let cancelled = false

    const loadExistingCapability = async () => {
      try {
        const appRes = await getRegistryAppByCapability(createCapabilitySelection)
        if (cancelled) return

        setCapabilityName(createCapabilitySelection)

        const app = appRes?.data?.app
        if (app) {
          setAppName(app.app_name || "")
          setRepoName(app.app_repo_name || "")
        } else {
          setAppName("")
          setRepoName("")
        }
      } catch (err) {
        console.error(err)
      }
    }

    loadExistingCapability()
    return () => {
      cancelled = true
    }
  }, [factoryMode, createCapabilitySelection])

  useEffect(() => {
    if (factoryMode !== "manage_usecase_agent" && factoryMode !== "govern_existing") return
    if (!capabilityName) {
      setAppName("")
      setRepoName("")
      setRegistryUsecases([])
      setRegistryAgents([])
      return
    }

    let cancelled = false

    const loadCapabilityContext = async () => {
      try {
        const [appRes, usecasesRes] = await Promise.all([
          getRegistryAppByCapability(capabilityName),
          getRegistryUsecases(capabilityName),
        ])

        if (cancelled) return

        const app = appRes?.data?.app
        if (app) {
          setAppName(app.app_name || "")
          setRepoName(app.app_repo_name || "")
        } else {
          setAppName("")
          setRepoName("")
        }

        const usecases = usecasesRes?.data?.usecases || []
        setRegistryUsecases(usecases)

        if (factoryMode === "govern_existing" && usecases.length > 0 && !usecaseName) {
          setUsecaseName(usecases[0])
        }

        if (
          factoryMode === "manage_usecase_agent" &&
          manageUsecaseMode === "existing" &&
          usecases.length > 0 &&
          !usecaseName
        ) {
          setUsecaseName(usecases[0])
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setAppName("")
          setRepoName("")
          setRegistryUsecases([])
          setRegistryAgents([])
        }
      }
    }

    loadCapabilityContext()
    return () => {
      cancelled = true
    }
  }, [factoryMode, capabilityName, manageUsecaseMode])

  useEffect(() => {
    const shouldLoadAgents =
      factoryMode === "govern_existing" ||
      (factoryMode === "manage_usecase_agent" && manageUsecaseMode === "existing")

    if (!shouldLoadAgents) {
      setRegistryAgents([])
      return
    }

    if (!capabilityName || !usecaseName) {
      setRegistryAgents([])
      return
    }

    let cancelled = false

    const loadAgents = async () => {
      try {
        const res = await getRegistryAgents(capabilityName, usecaseName)
        if (cancelled) return

        const agents = res.data.agents || []
        setRegistryAgents(agents)

        if (factoryMode === "govern_existing") {
          if (agents.length > 0) {
            const first = agents[0]
            setSelectedGovernAgentRepo((prev) => prev || first.agent_repo_name || "")
            setAgentType(first.agent_type || "chat_agent")
            setAgentName(first.agent_name || "")
            setAgentRepoName(first.agent_repo_name || "")
          } else {
            setSelectedGovernAgentRepo("")
          }
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setRegistryAgents([])
        }
      }
    }

    loadAgents()
    return () => {
      cancelled = true
    }
  }, [factoryMode, manageUsecaseMode, capabilityName, usecaseName])

  useEffect(() => {
    if (factoryMode !== "govern_existing" || !selectedGovernAgentRepo) return

    const selected = registryAgents.find(
      (a) => a.agent_repo_name === selectedGovernAgentRepo
    )
    if (!selected) return

    setAgentType(selected.agent_type || "chat_agent")
    setAgentName(selected.agent_name || "")
    setAgentRepoName(selected.agent_repo_name || "")
  }, [factoryMode, selectedGovernAgentRepo, registryAgents])

  useEffect(() => {
    if (factoryMode !== "create_capability") return
    if (createCapabilitySelection !== "__new__") return
    if (repoNameTouched) return

    const base = slugify(appName)
    if (!base) {
      setRepoName("")
      return
    }

    getNextAvailableRepoName(base)
      .then((res) => setRepoName(res.data.suggested || base))
      .catch(() => setRepoName(base))
  }, [factoryMode, createCapabilitySelection, appName, repoNameTouched])

  useEffect(() => {
    if (factoryMode !== "manage_usecase_agent") return
    if (agentRepoNameTouched) return

    const base = slugify(agentName)
    if (!base) {
      setAgentRepoName("")
      return
    }

    getNextAvailableRepoName(base)
      .then((res) => setAgentRepoName(res.data.suggested || base))
      .catch(() => setAgentRepoName(base))
  }, [factoryMode, agentName, agentRepoNameTouched])

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
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

  const refreshCapabilities = async () => {
    try {
      const res = await getRegistryCapabilities()
      setRegistryCapabilities(res.data.capabilities || [])
    } catch (err) {
      console.error(err)
    }
  }

  const handleCreateCapability = async () => {
    try {
      setMessage("")
      setResult(null)

      if (createCapabilitySelection !== "__new__") {
        setMessage("Capability already exists. Use Manage Usecase / Agent.")
        return
      }

      if (!capabilityName || !appName || !repoName) {
        setMessage("Error: capability, app name, and app repo are required.")
        return
      }

      if (registryCapabilities.includes(capabilityName)) {
        setMessage("Capability already exists. Use Manage Usecase / Agent.")
        return
      }

      const appExists = await repoExists(repoName)
      if (appExists) {
        setMessage(`Error: App repo name already exists: ${repoName}`)
        return
      }

      const res = await createCapability({
        capability_name: capabilityName,
        app_name: appName,
        app_repo_name: repoName,
        description,
      })

      if (!res?.data?.ok) {
        throw new Error(res?.data?.error || "create capability failed")
      }

      setResult(res.data)
      setMessage("Capability created successfully.")
      await refreshCapabilities()
    } catch (err: any) {
      console.error(err)
      setResult(null)
      setMessage(`Error: ${err?.response?.data?.error || err.message}`)
    }
  }

  const handleManageUsecaseAgent = async () => {
    try {
      setMessage("")
      setResult(null)

      if (!capabilityName || !appName || !repoName) {
        setMessage("Error: select a capability first.")
        return
      }

      if (!usecaseName || !agentName || !agentRepoName) {
        setMessage("Error: use case, agent name, and agent repo are required.")
        return
      }

      if (
        manageUsecaseMode === "new" &&
        registryUsecases.some((u) => u.toLowerCase() === usecaseName.toLowerCase())
      ) {
        setMessage("Error: this use case already exists. Switch to Existing Use Case.")
        return
      }

      const agentExists = await repoExists(agentRepoName)
      if (agentExists) {
        setMessage(`Error: Agent repo name already exists: ${agentRepoName}`)
        return
      }

      const writeTools = availableTools
        .filter((t) => t.mode === "write" && selectedTools.includes(t.name))
        .map((t) => t.name)

      const payload = {
        industry,
        customer_name: customer,
        line_of_business: lob,
        factory_mode: "manage_usecase_agent",
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
              capability_name: capabilityName,
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

      await startWorkspace(createdAgentRepo, createdAppRepo)
      const workspaceStatusRes = await getWorkspaceStatus()

      setResult({
        ...(createRes.data || {}),
        workspace: workspaceStatusRes.data,
        workspace_urls: workspaceStatusRes.data?.urls,
      })
      setMessage("Use case / agent created successfully.")

      const usecasesRes = await getRegistryUsecases(capabilityName)
      setRegistryUsecases(usecasesRes.data.usecases || [])

      if (manageUsecaseMode === "existing") {
        const agentsRes = await getRegistryAgents(capabilityName, usecaseName)
        setRegistryAgents(agentsRes.data.agents || [])
      }
    } catch (err: any) {
      console.error(err)
      setResult(null)
      setMessage(`Error: ${err?.response?.data?.error || err.message}`)
    }
  }

  const loadExistingContract = async () => {
    if (!capabilityName || !usecaseName || !agentType) {
      setMetadataMessage("Capability, use case, and agent type are required.")
      return
    }

    try {
      const contractRes = await getUsecaseContract(capabilityName, usecaseName, agentType)
      const contract = contractRes?.data?.contract

      if (!contractRes?.data?.ok || !contract) {
        setUsecaseMetadata(null)
        setMetadataMessage("No persisted contract found.")
        return
      }

      const contractAsMetadata: UsecaseMetadata = {
        capability_name: contract.capability_name,
        usecase_name: contract.usecase_name,
        default_agent_type: contract.agent_type,
        supported_agent_types: [contract.agent_type],
        components: contract.components || {
          planner: true,
          responder: true,
          workflow: false,
          router: false,
        },
        prompt_types: contract.prompt_types || [],
        features: {
          memory: { supported: true, configurable: true, default: !!contract.features?.memory },
          rag: { supported: true, configurable: true, default: !!contract.features?.rag },
          hitl: { supported: true, configurable: true, default: !!contract.features?.hitl },
          model: { supported: true, configurable: true, default: contract.default_model || "gpt-4o-mini" },
        },
      }

      setUsecaseMetadata(contractAsMetadata)
      setMetadataMessage("Existing contract loaded from persisted contract store.")
    } catch (err: any) {
      console.error(err)
      setUsecaseMetadata(null)
      setMetadataMessage(`Contract load failed: ${err?.response?.data?.error || err.message}`)
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
            Create capability apps, manage use cases and agents, and govern existing contracts.
          </p>
        </div>

        <div style={{ ...sectionStyle, marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <strong>Mode</strong>
            <button type="button" onClick={() => setFactoryMode("create_capability")} style={pillButton(factoryMode === "create_capability")}>
              Create Capability
            </button>
            <button type="button" onClick={() => setFactoryMode("manage_usecase_agent")} style={pillButton(factoryMode === "manage_usecase_agent")}>
              Manage Usecase / Agent
            </button>
            <button type="button" onClick={() => setFactoryMode("govern_existing")} style={pillButton(factoryMode === "govern_existing")}>
              Govern Existing
            </button>
          </div>

          <div style={{ fontSize: 13, color: "#4b5563" }}>{metadataMessage}</div>
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
              <h2 style={{ marginTop: 0, marginBottom: 12 }}>
                {factoryMode === "create_capability" ? "Capability" : "Basic Information"}
              </h2>

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
                  <label style={labelStyle}>Capability Name</label>
                  {factoryMode === "create_capability" ? (
                    <select
                      style={inputStyle}
                      value={createCapabilitySelection}
                      onChange={(e) => setCreateCapabilitySelection(e.target.value)}
                    >
                      <option value="__new__">Create new capability...</option>
                      {registryCapabilities.map((cap) => (
                        <option key={cap} value={cap}>
                          {cap}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      style={inputStyle}
                      value={capabilityName}
                      onChange={(e) => {
                        const value = e.target.value
                        setCapabilityName(value)
                        setUsecaseName("")
                        setRegistryUsecases([])
                        setRegistryAgents([])
                        setSelectedGovernAgentRepo("")
                        setUsecaseMetadata(null)
                      }}
                    >
                      <option value="">Select capability</option>
                      {registryCapabilities.map((cap) => (
                        <option key={cap} value={cap}>
                          {cap}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label style={labelStyle}>Application Name</label>
                  <input
                    style={
                      factoryMode === "create_capability" && !createCapabilityExistingSelected
                        ? inputStyle
                        : readonlyInputStyle
                    }
                    placeholder="CM Capability App"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    readOnly={
                      factoryMode !== "create_capability" || createCapabilityExistingSelected
                    }
                  />
                </div>

                <div>
                  <label style={labelStyle}>App Repo Name</label>
                  <input
                    style={
                      factoryMode === "create_capability" && !createCapabilityExistingSelected
                        ? inputStyle
                        : readonlyInputStyle
                    }
                    placeholder="cm-capability-app"
                    value={repoName}
                    onChange={(e) => {
                      setRepoNameTouched(true)
                      setRepoName(e.target.value)
                    }}
                    readOnly={
                      factoryMode !== "create_capability" || createCapabilityExistingSelected
                    }
                  />
                </div>

                <div>
                  <label style={labelStyle}>App Template Used</label>
                  <input style={readonlyInputStyle} value="app-template" readOnly />
                </div>
              </div>

              {factoryMode === "create_capability" && createCapabilitySelection === "__new__" && (
                <div style={{ marginTop: 14 }}>
                  <label style={labelStyle}>New Capability Name</label>
                  <input
                    style={inputStyle}
                    placeholder="care-management"
                    value={capabilityName}
                    onChange={(e) => setCapabilityName(e.target.value)}
                  />
                </div>
              )}

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

            {factoryMode === "manage_usecase_agent" && (
              <>
                <div style={sectionStyle}>
                  <h2 style={{ marginTop: 0, marginBottom: 12 }}>Manage Usecase / Agent</h2>

                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Use Case Action</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setManageUsecaseMode("new")
                          setUsecaseName("")
                          setRegistryAgents([])
                        }}
                        style={pillButton(manageUsecaseMode === "new")}
                      >
                        New Use Case + New Agent
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setManageUsecaseMode("existing")
                          if (registryUsecases.length > 0) {
                            setUsecaseName(registryUsecases[0])
                          }
                        }}
                        style={pillButton(manageUsecaseMode === "existing")}
                      >
                        Existing Use Case + New Agent
                      </button>
                    </div>
                  </div>

                  <div style={compactGrid}>
                    <div>
                      <label style={labelStyle}>Use Case Name</label>
                      {manageUsecaseMode === "new" ? (
                        <input
                          style={inputStyle}
                          value={usecaseName}
                          onChange={(e) => setUsecaseName(e.target.value)}
                        />
                      ) : (
                        <select
                          style={inputStyle}
                          value={registryUsecases.includes(usecaseName) ? usecaseName : ""}
                          onChange={(e) => setUsecaseName(e.target.value)}
                        >
                          <option value="">Select use case</option>
                          {registryUsecases.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div>
                      <label style={labelStyle}>Agent Type</label>
                      <select
                        style={inputStyle}
                        value={agentType}
                        onChange={(e) => setAgentType(e.target.value)}
                      >
                        {BASE_AGENT_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} disabled={!option.enabled}>
                            {option.label}{option.enabled ? "" : " (coming soon)"}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={labelStyle}>Agent Name</label>
                      <input
                        style={inputStyle}
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>Agent Repo Name</label>
                      <input
                        style={inputStyle}
                        value={agentRepoName}
                        onChange={(e) => {
                          setAgentRepoNameTouched(true)
                          setAgentRepoName(e.target.value)
                        }}
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
                      <label style={labelStyle}>Agent Template Used</label>
                      <input style={readonlyInputStyle} value="chat-agent-template" readOnly />
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#374151" }}>
                      Existing Use Cases
                    </div>
                    {registryUsecases.length > 0 ? (
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {registryUsecases.join(" | ")}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        No existing use cases found for this capability.
                      </div>
                    )}
                  </div>

                  {manageUsecaseMode === "existing" && usecaseName && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#374151" }}>
                        Existing Agents for Selected Use Case
                      </div>
                      {registryAgents.length > 0 ? (
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          {registryAgents.map((agent) => (
                            <div key={agent.agent_repo_name}>
                              {agent.agent_name} — {agent.agent_repo_name} ({agent.agent_type})
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          No existing agents found for this use case.
                        </div>
                      )}
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
                            <option key={option.value} value={option.value} disabled={!option.enabled}>
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
                        <input style={readonlyInputStyle} value={usecaseName} readOnly />
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
              </>
            )}

            {factoryMode === "govern_existing" && (
              <div style={sectionStyle}>
                <h2 style={{ marginTop: 0, marginBottom: 12 }}>Govern Existing</h2>

                <div style={compactGrid}>
                  <div>
                    <label style={labelStyle}>Use Case</label>
                    <select
                      style={inputStyle}
                      value={registryUsecases.includes(usecaseName) ? usecaseName : ""}
                      onChange={(e) => {
                        setUsecaseName(e.target.value)
                        setSelectedGovernAgentRepo("")
                      }}
                    >
                      <option value="">Select use case</option>
                      {registryUsecases.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Agent</label>
                    <select
                      style={inputStyle}
                      value={
                        registryAgents.some((a) => a.agent_repo_name === selectedGovernAgentRepo)
                          ? selectedGovernAgentRepo
                          : ""
                      }
                      onChange={(e) => setSelectedGovernAgentRepo(e.target.value)}
                    >
                      <option value="">Select agent</option>
                      {registryAgents.map((agent) => (
                        <option key={agent.agent_repo_name} value={agent.agent_repo_name}>
                          {agent.agent_name} ({agent.agent_type})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={loadExistingContract}
                    style={pillButton(false)}
                  >
                    Load Existing Contract
                  </button>
                </div>

                {usecaseMetadata && (
                  <div style={{ marginTop: 14, fontSize: 12, color: "#6b7280" }}>
                    <div style={{ fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                      Contract Loaded
                    </div>
                    <div>
                      Components: planner={String(usecaseMetadata.components?.planner)} | responder=
                      {String(usecaseMetadata.components?.responder)} | workflow=
                      {String(usecaseMetadata.components?.workflow)} | router=
                      {String(usecaseMetadata.components?.router)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 18, position: "sticky", top: 16 }}>
            {factoryMode === "create_capability" && (
              <>
                <div style={sectionStyle}>
                  <button
                    onClick={handleCreateCapability}
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
                    Create Capability
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
                    <h2 style={{ marginTop: 0, marginBottom: 12 }}>Capability Result</h2>
                    <div><strong>Status:</strong> {result.status}</div>
                    <div><strong>Capability:</strong> {result.capability_name}</div>
                    <div><strong>App Name:</strong> {result.app_name}</div>
                    <div><strong>App Repo:</strong> {result.app_repo_name}</div>
                    <div><strong>App Created:</strong> {String(result.app_created)}</div>
                    <div><strong>App Reused:</strong> {String(result.app_reused)}</div>
                    <div><strong>App Path:</strong> {result.app_repo_url}</div>
                  </div>
                )}
              </>
            )}

            {factoryMode === "manage_usecase_agent" && (
              <>
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
                            Teaser only for now.
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
                    onClick={handleManageUsecaseAgent}
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
                    Create Usecase / Agent
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
                    <div><strong>Capability:</strong> {result.capability_name}</div>
                    <div><strong>Use Case:</strong> {result.usecase_name}</div>
                    <div><strong>App Repo:</strong> {result.app_repo_name}</div>
                    <div><strong>App Reused:</strong> {String(result.app_reused)}</div>
                    <div><strong>App Created:</strong> {String(result.app_created)}</div>

                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                      <div><strong>Workspace Ready:</strong> {String(result.workspace?.ok)}</div>
                      <div><strong>Tool Gateway Ready:</strong> {String(!!result.workspace_urls?.tool_gateway_url)}</div>
                      <div><strong>Agent Runtime Ready:</strong> {String(!!result.workspace_urls?.agent_runtime_url)}</div>
                      <div><strong>App UI Ready:</strong> {String(!!result.workspace_urls?.app_ui_url)}</div>
                    </div>

                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                      <div><strong>App UI:</strong> {result.workspace_urls?.app_ui_url}</div>
                      <div><strong>Agent Runtime:</strong> {result.workspace_urls?.agent_runtime_url}</div>
                      <div><strong>Tool Gateway:</strong> {result.workspace_urls?.tool_gateway_url}</div>
                    </div>
                  </div>
                )}
              </>
            )}

            {factoryMode === "govern_existing" && (
              <div style={sectionStyle}>
                <h2 style={{ marginTop: 0, marginBottom: 12 }}>Governance Actions</h2>
                <div style={{ fontSize: 13, color: "#4b5563", marginBottom: 14 }}>
                  Prompt lifecycle and evaluation can be plugged in here later.
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <button type="button" style={pillButton(false)}>View Prompt Governance</button>
                  <button type="button" style={pillButton(false)}>Create Prompt Version</button>
                  <button type="button" style={pillButton(false)}>Run Prompt Evaluation</button>
                </div>

                <div style={{ marginTop: 14, fontSize: 12, color: "#6b7280" }}>
                  These actions are placeholders for the next lifecycle step.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 