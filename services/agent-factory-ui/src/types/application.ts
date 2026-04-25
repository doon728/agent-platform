export interface CreateApplicationRequest {
    industry: string
    customer_name: string
    line_of_business: string
  
    app: {
      repo_name: string
      app_name: string
      ui_type: string
      description?: string
    }
  
    agents: Array<{
      agent_name: string
      agent_type: string
      mode: "create_new" | "reuse_existing"
      capabilities: string[]
      existing_agent_repo?: string | null
      existing_agent_endpoint?: string | null
      create_config?: {
        repo_name: string
        usecase_name: string
        agent_type: string
        persona: string
        tool_policy: {
          mode: string
          allowed_tools: string[]
          allowed_tags: string[]
        }
        rag: {
          enabled: boolean
          top_k: number
          score_threshold: number
        }
        model: {
          provider: string
          model: string
          temperature: number
        }
        approval: {
          enabled: boolean
          write_tools: string[]
        }
        memory: {
          enabled: boolean
          thread: boolean
          case: boolean
          long_term: boolean
        }
        embeddings: {
          provider: string
          model: string
        }
        chunking: {
          strategy: string
          chunk_size: number
          chunk_overlap: number
        }
        document_ingestion: {
          enabled: boolean
          upload_via_ui: boolean
          allowed_types: string[]
          auto_embed_on_upload: boolean
        }
        prompts: {
          planner_system_prompt: string
          responder_system_prompt: string
        }
      }
    }>
  }