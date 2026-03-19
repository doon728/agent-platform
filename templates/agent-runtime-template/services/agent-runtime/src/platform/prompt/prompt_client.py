import os
import requests
from src.platform.config import load_config

class PromptServiceClient:
    def __init__(self):
        
        cfg = load_config()
        self.base_url = cfg.prompt_service.url

        def resolve_prompt(
            self,
            capability_name: str,
            agent_type: str,
            usecase_name: str,
            prompt_type: str,
            environment: str,
        ):
        if not self.base_url:
            return None

        try:
            resp = requests.get(
                f"{self.base_url}/prompts/resolve",
                params={
                    "capability_name": capability_name,
                    "agent_type": agent_type,
                    "usecase_name": usecase_name,
                    "prompt_type": prompt_type,
                    "environment": environment,
                },
                timeout=3,
            )
            if resp.status_code == 200:
                return resp.json()["prompt"]["template_text"]
        except Exception:
            return None

        return None