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

> If you prefer pinning to a specific docker image build (e.g. 20250413-165732), use that tag instead of latest. Browse available versions on [Dockerhub](https://hub.docker.com/r/ashgw/vault-mcp/tags).

Once added, you can use prompts like:

> "Read the secret at path `apps/myapp/config` from Vault"

Cursor will route that request through the MCP server automatically.

Check if it works, it should be green

![image](https://github.com/user-attachments/assets/74bb2f65-99ce-46b9-944f-c10a365ab53f)

---

## Local Development

You have two ways to run locally: Docker (recommended, no local setup needed) or Bun (from source).

### Prerequisites

- **Docker** OR **Bun** (install from https://bun.sh)
- A Vault server with KV v2 enabled at `secret/` mount
- Valid Vault token with read/write permissions

### Start a Local Vault (Dev Mode)

Quick way to get a test Vault running:

```bash
docker run --rm -it --cap-add=IPC_LOCK \
  -e VAULT_DEV_ROOT_TOKEN_ID=hvs.localroot \
  -p 8200:8200 hashicorp/vault:1.16

export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=hvs.localroot

# Enable KV v2 at secret/ if not already enabled
vault secrets enable -path=secret -version=2 kv
```

---

### Docker (Local, Manual)

Using the official published image:

```bash
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=hvs.localroot

docker run -i --rm \
  -e VAULT_ADDR=$VAULT_ADDR \
  -e VAULT_TOKEN=$VAULT_TOKEN \
  ashgw/vault-mcp:latest
```

Or build and run from source:

```bash
docker build -t vault-mcp .
docker run -i --rm \
  -e VAULT_ADDR=$VAULT_ADDR \
  -e VAULT_TOKEN=$VAULT_TOKEN \
  vault-mcp
```

The server runs via stdio and waits for an MCP client connection (Cursor, etc.). Without a client connected, it will appear idle.

---

### Bun (Local, From Source)

**Prerequisites:**

- Install Bun: https://bun.sh

**Steps:**

1. Install dependencies:

```bash
bun install
```

2. Lint and typecheck:

```bash
bun run lint
bun run typecheck
```

3. Build:

```bash
bun run build
```

4. Run the server:

```bash
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=hvs.localroot

node dist/index.js
# or: bun dist/index.js
```

The server runs via stdio and waits for an MCP client connection. Connect using Cursor or another MCP client.

---

### Testing Vault API Directly (Optional)

These curl commands verify Vault is working correctly (not MCP). Useful for debugging:

**Write KV v2 data:**

```bash
curl -sS -X POST -H "X-Vault-Token: $VAULT_TOKEN" -H "Content-Type: application/json" \
  -d '{"data":{"username":"demo","password":"s3cr3t"}}' \
  "$VAULT_ADDR/v1/secret/data/app/config"
```

**Read KV v2 data:**

```bash
curl -sS -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/data/app/config" | jq
```

**List keys:**

```bash
curl -sS -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/metadata?list=true" | jq
```

**Create/update ACL policy:**

```bash
curl -sS -X PUT -H "X-Vault-Token: $VAULT_TOKEN" -H "Content-Type: application/json" \
  -d '{"policy":"path \"secret/data/app/*\" { capabilities=[\"read\",\"list\"] }"}' \
  "$VAULT_ADDR/v1/sys/policies/acl/demo-policy"
```

---

## Environment Variables

These are required to run the MCP Vault server:

- `VAULT_ADDR`: Your HashiCorp Vault server address (e.g., `http://127.0.0.1:8200`)
- `VAULT_TOKEN`: A valid Vault token with read/write permissions (must start with `hvs.`)
- `MCP_PORT`: Optional. Defaults to 3000. Not required for Cursor (uses stdio).

---

## Troubleshooting

- **Tools don't appear in client**: Ensure you're launching via an MCP client (like Cursor). All tools have descriptions and should appear.
- **KV mount not found**: Make sure KV v2 is enabled at `secret/` mount: `vault secrets enable -path=secret -version=2 kv`
- **Token errors**: Token must start with `hvs.` and have permissions to access `secret/` mount and `sys/policies/acl`
- **TLS/SSL issues**: If using HTTPS with self-signed certificates, configure your environment accordingly

---

## License

[MIT](/LICENSE)
