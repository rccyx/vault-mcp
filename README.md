# HashiCorp Vault MCP Server

A Model Context Protocol (MCP) server implementation that provides a secure interface to HashiCorp Vault which enables LLMs and other MCP clients to interact with Vault's secret and policy management features.

## Overview

This allows you to prompt an LLM to:

- Secure secret management through structured API
- Policy creation and management
- Resource discovery and listing
- Automated policy generation

---

## Features in Detail

### Secret Management Tools

#### `create_secret`

Creates or updates a secret at specified path in KV v2.

```ts
await tool("create_secret", {
  path: "apps/myapp/config",
  data: {
    apiKey: "secret-key-123",
    environment: "production",
  },
});
```

#### `read_secret`

Retrieves a secret from specified path in KV v2.

```ts
await tool("read_secret", {
  path: "apps/myapp/config",
});
```

#### `delete_secret`

Soft-deletes the latest version of a secret in KV v2.

```ts
await tool("delete_secret", {
  path: "apps/myapp/config",
});
```

---

### Policy Management

#### `create_policy`

Creates or replaces a Vault ACL policy with specified permissions.

```ts
await tool("create_policy", {
  name: "app-readonly",
  policy: `
    path "secret/data/apps/myapp/*" {
      capabilities = ["read", "list"]
    }
  `,
});
```

---

### Resources

#### `vault://secrets`

Lists all available secret paths in the KV store.

```json
{
  "keys": ["apps/", "databases/", "certificates/"]
}
```

#### `vault://policies`

Lists all available Vault ACL policy names.

```json
{
  "policies": ["default", "app-readonly", "admin"]
}
```

---

### Prompts

#### `generate_policy`

Generates a minimal Vault policy block from path and capabilities.

```ts
await prompt("generate_policy", {
  path: "secret/data/apps/*",
  capabilities: "read,list",
});
```

Returns:

```json
{
  "path": {
    "secret/data/apps/*": {
      "capabilities": ["read", "list"]
    }
  }
}
```

---

## Quickstart

### Cursor (recommended)

Add this to your Cursor MCP configuration:

```json
{
  "mcpServers": {
    "Vault MCP": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "VAULT_ADDR=https://your-vault-server:8200",
        "-e",
        "VAULT_TOKEN=hvs.your-vault-token",
        "ashgw/vault-mcp:latest"
      ]
    }
  }
}
```

> If you prefer pinning to a specific version (e.g. 1.2.0), use that tag instead of latest. Browse available versions on [Dockerhub](https://hub.docker.com/r/ashgw/vault-mcp/tags).

Once added, you can use prompts like:

> "Read the secret at path `apps/myapp/config` from Vault"

Cursor will route that request through the MCP server automatically.

Check if it works, it should be green

![image](https://github.com/user-attachments/assets/74bb2f65-99ce-46b9-944f-c10a365ab53f)

## Localy Setup

## Environment Variables

These are required to run the MCP Vault server:

- `VAULT_ADDR`: Your HashiCorp Vault server address (e.g., `http://127.0.0.1:8200`)
- `VAULT_TOKEN`: A valid Vault token with read/write permissions (must start with `hvs.`)
- `MCP_PORT`: Optional. Defaults to 3000. Not required for Cursor (uses stdio).

## License

[MIT](/LICENSE)
