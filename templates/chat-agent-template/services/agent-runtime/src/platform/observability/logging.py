import logging
from config.settings import load_config

def setup_logging():
    """
    Configure logging based on environment configuration
    """
    log_config = load_config()['logging']
    
    # Configure logging level
    log_level = getattr(logging, log_config['level'].upper())
    
    # Basic configuration
    logging.basicConfig(
        level=log_level,
        format=log_config['format']
    )
    # Create a logger for the application
    logger = logging.getLogger('agent_runtime')
    return logger

# Create a global logger instance
logger = setup_logging()
