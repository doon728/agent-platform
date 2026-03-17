import os
import yaml
from typing import Dict, Any

class ConfigurationError(Exception):
    """Raised when configuration cannot be loaded"""
    pass

def load_config(env: str = None) -> Dict[str, Any]:
    """
    Load configuration based on environment.
    """
    if env is None:
        env = os.environ.get('AGENT_ENV', 'dev')
    
    config_path = os.path.join(
        os.path.dirname(__file__), 
        f"{env}.yaml"
    )
    
    print(f"Loading config from: {config_path}")
    print(f"Current environment: {env}")
    
    try:
        with open(config_path, 'r') as config_file:
            config = yaml.safe_load(config_file)
            print(f"Loaded config: {config}")
            return config
    except FileNotFoundError:
        print(f"Configuration file {config_path} not found")
        raise ConfigurationError(f"Configuration file for {env} not found")
    except yaml.YAMLError as e:
        print(f"YAML parsing error: {e}")
        raise ConfigurationError(f"Error parsing configuration: {e}")

def get_config(key: str, default=None):
    """
    Retrieve a configuration value, with optional default.
    """
    config = load_config()
    
    # Traverse nested dictionary
    for k in key.split('.'):
        if isinstance(config, dict) and k in config:
            config = config[k]
        else:
            return default
    
    return config
