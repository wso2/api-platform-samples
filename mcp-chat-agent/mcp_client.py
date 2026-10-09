from mcp_use import MCPAgent, MCPClient
from langchain_mistralai import ChatMistralAI
from langchain_openai import ChatOpenAI, AzureChatOpenAI
from oauth2_utils import process_mcp_config_with_oauth2

import os
os.environ["MCP_USE_ANONYMIZED_TELEMETRY"] = "false"

# Global variables to cache LLM and client instances
_cached_llm = None
_cached_client = None
_cached_config = None
_cached_agent = None

custom_prompt = """
You are a helpful assistant which helps users in their queries. In these queries try to response using
your general knowledge or use the available tools provided to you. Ensure you respond to the query as relevant as possible.
DO NOT Explain your reasoning or the tools you are using to the user.
The respones should be human-like and should not contain any unnatural language.
"""
def _config_changed(current_config, cached_config):
    """Check if the current config is different from the cached config."""
    if cached_config is None:
        return True
    
    relevant_fields = [
        "provider", "api_key", "model_name", "azure_deployment", 
        "api_version", "azure_endpoint", "mcp"
    ]
    
    for field in relevant_fields:
        if current_config.get(field) != cached_config.get(field):
            return True
    
    return False

def _create_llm(config):
    """Create LLM instance based on configuration."""
    provider = config.get("provider", "openai")
    api_key = config.get("api_key", "")
    
    if provider == "openai":
        model_name = config.get("model_name", "")
        return ChatOpenAI(model=model_name, api_key=api_key)
    elif provider == "azure_openai":
        azure_deployment = config.get("azure_deployment", "")
        api_version = config.get("api_version", "")
        azure_endpoint = config.get("azure_endpoint", "")
        return AzureChatOpenAI(
            model=azure_deployment,
            api_version=api_version,
            azure_endpoint=azure_endpoint,
            api_key=api_key,
            temperature=0.1,
        )
    elif provider == "mistralai":
        model_name = config.get("model_name", "")
        return ChatMistralAI(model=model_name, api_key=api_key)
    else:
        model_name = config.get("model_name", "")
        return ChatOpenAI(model=model_name, api_key=api_key)

async def _initialize_agent(config):
    """Initialize the agent with the given configuration."""
    global _cached_llm, _cached_client, _cached_config, _cached_agent
    
    # Create LLM instance
    _cached_llm = _create_llm(config)
    
    # Create client instance with OAuth2 processing
    mcp_config = config.get("mcp", {})
        
    # Process OAuth2 authentication
    processed_mcp_config = await process_mcp_config_with_oauth2(mcp_config)
    _cached_client = MCPClient.from_dict(processed_mcp_config)
    
    # Cache the current config
    _cached_config = config.copy()
    
    # Create agent with from llm and client
    _cached_agent = MCPAgent(
        llm=_cached_llm, 
        client=_cached_client, 
        system_prompt=custom_prompt, 
        memory_enabled=True, 
        max_steps=30,
    )

async def async_main(query, config=None):
    global _cached_llm, _cached_client, _cached_config, _cached_agent
    
    if config is None:
        config = {}
    
    # Only initialize/reinitialize agent if config changed or agent doesn't exist
    if _cached_agent is None or _config_changed(config, _cached_config):
        await _initialize_agent(config)
    
    # Use the existing agent with memory for the query
    result = await _cached_agent.run(query)
    return str(result)

def clear_conversation_history():
    """Clear the conversation history of the cached agent."""
    global _cached_agent
    if _cached_agent is not None:
        _cached_agent.clear_conversation_history()

async def cleanup():
    """Clean up resources when shutting down."""
    global _cached_client
    if _cached_client and hasattr(_cached_client, 'sessions'):
        await _cached_client.close_all_sessions()

