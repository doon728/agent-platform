import axios from "axios"

const FACTORY_API = axios.create({
  baseURL: import.meta.env.VITE_FACTORY_API
})

const GATEWAY_API = axios.create({
  baseURL: import.meta.env.VITE_GATEWAY_API
})

const SUPPORT_API = axios.create({
  baseURL: import.meta.env.VITE_SUPPORT_API
})

const PROMPT_API = axios.create({
  baseURL: import.meta.env.VITE_PROMPT_API
})

export const createApplication = (payload: any) => {
  return FACTORY_API.post("/create-application", payload)
}

export const createCapability = (payload: {
  capability_name: string
  app_name: string
  app_repo_name: string
  description?: string
}) => {
  return SUPPORT_API.post("/capability/create", payload)
}

export const getGatewayTools = () => {
  return GATEWAY_API.get("/tools/specs")
}

export const getNextAvailableRepoName = (base: string) => {
  return SUPPORT_API.get("/next-available-repo-name", {
    params: { base }
  })
}

export const startWorkspace = (agentRepo: string, appRepo: string) => {
  return SUPPORT_API.post("/workspace/start", null, {
    params: {
      agent_repo: agentRepo,
      app_repo: appRepo,
    },
  })
}

export const getWorkspaceStatus = () => {
  return SUPPORT_API.get("/workspace/status")
}

export const getRegistryCapabilities = () => {
  return SUPPORT_API.get("/registry/capabilities")
}

export const getRegistryUsecases = (capabilityName: string) => {
  return SUPPORT_API.get("/registry/usecases/by-capability", {
    params: {
      capability_name: capabilityName,
    },
  })
}

export const getRegistryAgents = (capabilityName: string, usecaseName: string) => {
  return SUPPORT_API.get("/registry/agents", {
    params: {
      capability_name: capabilityName,
      usecase_name: usecaseName,
    },
  })
}

export const getRegistryAppByCapability = (capabilityName: string) => {
  return SUPPORT_API.get("/registry/app-by-capability", {
    params: {
      capability_name: capabilityName,
    },
  })
}

export const getUsecaseContract = (
  capabilityName: string,
  usecaseName: string,
  agentType: string
) => {
  return SUPPORT_API.get("/contracts/usecase", {
    params: {
      capability_name: capabilityName,
      usecase_name: usecaseName,
      agent_type: agentType,
    },
  })
}

export const listPrompts = () => {
  return PROMPT_API.get("/prompts")
}

export const getPrompt = (promptId: string) => {
  return PROMPT_API.get(`/prompts/${promptId}`)
}

export const resolvePrompt = (params: any) => {
  return PROMPT_API.get("/prompts/resolve", { params })
}

export const approvePrompt = (promptId: string, version: number) => {
  return PROMPT_API.post(`/prompts/${promptId}/approve`, null, {
    params: { version }
  })
}

export const activatePrompt = (promptId: string, version: number) => {
  return PROMPT_API.post(`/prompts/${promptId}/activate`, null, {
    params: { version }
  })
}

export const getAgentManifest = (capability_name: string, usecase_name: string, agent_type: string) => {
  return SUPPORT_API.get("/registry/agent-manifest", {
    params: { capability_name, usecase_name, agent_type },
  })
}

export const getTemplateManifest = (agent_type: string) => {
  return SUPPORT_API.get("/registry/template-manifest", {
    params: { agent_type },
  })
}

export const getAgentConfig = (capability_name: string, usecase_name: string, agent_type: string) => {
  return SUPPORT_API.get("/registry/agent-config", {
    params: { capability_name, usecase_name, agent_type },
  })
}

export const patchAgentConfig = (payload: {
  capability_name: string
  usecase_name: string
  agent_type: string
  section: string
  changes: Record<string, any>
}) => {
  return SUPPORT_API.patch("/registry/agent-config", payload)
}

export const getAgentStatus = () => {
  return SUPPORT_API.get("/registry/agent-status")
}

export const restartAgent = (agentRepo: string, appRepo: string) => {
  return SUPPORT_API.post("/workspace/start", null, {
    params: { agent_repo: agentRepo, app_repo: appRepo },
  })
}

export const stopWorkspace = () => {
  return SUPPORT_API.post("/workspace/stop")
}

export const deleteWorkspace = () => {
  return SUPPORT_API.delete("/workspace/delete")
}