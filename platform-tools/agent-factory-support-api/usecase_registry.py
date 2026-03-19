USECASE_REGISTRY = {

    "care-management": {

        "cm_assistant": {

            "agents": {

                "chat_agent": {
                    "components": {
                        "planner": True,
                        "responder": True,
                        "router": False,
                        "workflow": False
                    },
                    "prompt_types": ["planner", "responder"],
                    "default_model": "gpt-4o-mini",
                    "features": {
                        "memory": True,
                        "rag": True,
                        "hitl": True
                    }
                },

                "workflow_agent": {
                    "components": {
                        "planner": True,
                        "responder": False,
                        "router": False,
                        "workflow": True
                    },
                    "prompt_types": ["planner"],
                    "default_model": "gpt-4o-mini",
                    "features": {
                        "memory": False,
                        "rag": False,
                        "hitl": True
                    }
                },

                "summarization_agent": {
                    "components": {
                        "planner": False,
                        "responder": True,
                        "router": False,
                        "workflow": False
                    },
                    "prompt_types": ["responder"],
                    "default_model": "gpt-4o-mini",
                    "features": {
                        "memory": False,
                        "rag": True,
                        "hitl": False
                    }
                }

            }
        }
    }
}