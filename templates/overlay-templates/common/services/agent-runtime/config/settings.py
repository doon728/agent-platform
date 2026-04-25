import os
import importlib.util
from typing import Dict, Any

class ConfigurationError(Exception):
    """Raised when configuration cannot be loaded"""
    pass

def load_config(env: str = None) -> Dict[str, Any]:
    """
    Load configuration based on environment with multiple import attempts.
    """
    # Attempt multiple import methods
    try:
        import yaml
        print("✅ PyYAML imported successfully")
    except ImportError:
        try:
            spec = importlib.util.find_spec('yaml')
            if spec is not None:
                print(f"PyYAML spec found: {spec}")
                yaml = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(yaml)
            else:
                print("❌ No PyYAML spec found")
                raise ImportError("PyYAML module not found")
        except Exception as e:
            print(f"❌ Import error: {e}")
            raise ConfigurationError(f"Could not import PyYAML: {e}")
    
    if env is None:
        env = os.environ.get('AGENT_ENV', 'dev')
    
    config_path = os.path.join(
        os.path.dirname(__file__), 
        f"{env}.yaml"
    )
    
    try:
        with open(config_path, 'r') as config_file:
            return yaml.safe_load(config_file)
    except FileNotFoundError:
        raise ConfigurationError(f"Configuration file for {env} not found")
    except yaml.YAMLError as e:
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
