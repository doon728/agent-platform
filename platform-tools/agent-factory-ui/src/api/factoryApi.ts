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

export const createApplication = (payload: any) => {
  return FACTORY_API.post("/create-application", payload)
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
const PROMPT_API = axios.create({
  baseURL: import.meta.env.VITE_PROMPT_API
})

export const listPrompts = () => {
  return PROMPT_API.get("/prompts")
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