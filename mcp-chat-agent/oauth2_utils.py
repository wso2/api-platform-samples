"""
OAuth2 utility functions for MCP server authentication.
"""
import base64
import httpx
import asyncio
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

async def get_oauth2_token(
    client_id: str, 
    client_secret: str, 
    token_endpoint: str,
    timeout: float = 30
) -> Optional[str]:
    """
    Get an OAuth2 access token using client credentials flow.
    
    Args:
        client_id: OAuth2 client ID
        client_secret: OAuth2 client secret
        token_endpoint: OAuth2 token endpoint URL
        timeout: Request timeout in seconds
        
    Returns:
        Access token string or None if failed
    """
    if not all([client_id, client_secret, token_endpoint]):
        logger.warning("Missing OAuth2 credentials")
        return None
        
    # Create basic auth header
    credentials = f"{client_id}:{client_secret}"
    encoded_credentials = base64.b64encode(credentials.encode()).decode()
    
    headers = {
        "Authorization": f"Basic {encoded_credentials}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    
    data = {
        "grant_type": "client_credentials"
    }
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                token_endpoint,
                headers=headers,
                data=data
            )
            response.raise_for_status()
            
            token_data = response.json()
            access_token = token_data.get("access_token")
            
            if access_token:
                logger.info("OAuth2 token retrieved successfully")
                return access_token
            else:
                logger.error("No access token in response")
                return None
                
    except httpx.HTTPStatusError as e:
        logger.error(f"OAuth2 token request failed with status {e.response.status_code}: {e.response.text}")
        return None
    except Exception as e:
        logger.error(f"OAuth2 token request failed: {e}")
        return None

async def process_mcp_config_with_oauth2(mcp_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process MCP configuration to handle OAuth2 authentication.
    
    Args:
        mcp_config: Original MCP configuration
        
    Returns:
        Modified MCP configuration with OAuth2 tokens converted to Authorization headers
    """
    if not mcp_config or "mcpServers" not in mcp_config:
        return mcp_config
    
    processed_config = mcp_config.copy()
    processed_servers = {}
    
    for server_name, server_config in mcp_config["mcpServers"].items():
        processed_server = server_config.copy()
        
        # Check if OAuth2 configuration exists
        oauth2_config = server_config.get("oauth2", {})
        if oauth2_config and all(
            key in oauth2_config and oauth2_config[key] 
            for key in ["client_id", "client_secret", "token_endpoint"]
        ):
            if  oauth2_config['client_id'] == "" or oauth2_config['client_secret']  == "" or oauth2_config['token_endpoint'] == "":
                del processed_server["oauth2"]
                processed_servers[server_name] = processed_server
                continue
            logger.info(f"Processing OAuth2 authentication for server: {server_name}")
            
            # Get OAuth2 token
            token = await get_oauth2_token(
                oauth2_config["client_id"],
                oauth2_config["client_secret"],
                oauth2_config["token_endpoint"]
            )
            
            if token:
                if "headers" not in processed_server:
                    processed_server["headers"] = {}
                processed_server["headers"]["Authorization"] = f"Bearer {token}"
                
                logger.info(f"OAuth2 token applied to server: {server_name}")
            else:
                logger.error(f"Failed to get OAuth2 token for server: {server_name}")
            del processed_server["oauth2"]
        
        processed_servers[server_name] = processed_server
    
    processed_config["mcpServers"] = processed_servers
    return processed_config
