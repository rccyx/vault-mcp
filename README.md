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

## Run Everything Locally with Docker

**Prerequisites:** Just Docker installed. That's it.

This guide shows you how to run Vault, the MCP server, and test everything locally using only Docker and curl.

### Step 1: Start Vault in Dev Mode

Start a local Vault dev server (this gives you a test Vault that resets on restart):

```bash
docker run -d --name vault-dev \
  --cap-add=IPC_LOCK \
  -p 8200:8200 \
  -e VAULT_DEV_ROOT_TOKEN_ID=hvs.localroot \
  hashicorp/vault:1.16
```

This runs Vault on `http://127.0.0.1:8200` with root token `hvs.localroot`.

### Step 2: Enable KV v2 Secret Engine

Vault dev mode doesn't enable KV v2 by default. Enable it via API:

```bash
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=hvs.localroot

curl -sS -X POST \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"kv","options":{"version":"2"}}' \
  "$VAULT_ADDR/v1/sys/mounts/secret"
```

This enables KV v2 at the `secret/` mount point (required for all secret operations).

### Step 3: Test Vault with curl

Verify everything works before running the MCP server:

**Write a secret:**

```bash
curl -sS -X POST \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"username":"demo","password":"s3cr3t"}}' \
  "$VAULT_ADDR/v1/secret/data/app/config" | jq
```

Expected response shows the secret metadata:

```json
{
  "request_id": "...",
  "lease_id": "",
  "renewable": false,
  "lease_duration": 0,
  "data": {
    "created_time": "...",
    "custom_metadata": null,
    "deletion_time": "",
    "destroyed": false,
    "version": 1
  }
}
```

**Read the secret back:**

```bash
curl -sS \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/data/app/config" | jq
```

Expected response:

```json
{
  "request_id": "...",
  "lease_id": "",
  "renewable": false,
  "lease_duration": 0,
  "data": {
    "data": {
      "username": "demo",
      "password": "s3cr3t"
    },
    "metadata": {
      "created_time": "...",
      "custom_metadata": null,
      "deletion_time": "",
      "destroyed": false,
      "version": 1
    }
  }
}
```

**List secret keys:**

```bash
curl -sS \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/metadata?list=true" | jq
```

Expected response:

```json
{
  "request_id": "...",
  "lease_id": "",
  "renewable": false,
  "lease_duration": 0,
  "data": {
    "keys": ["app/"]
  }
}
```

**Create a policy:**

```bash
curl -sS -X PUT \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"policy":"path \"secret/data/app/*\" { capabilities=[\"read\",\"list\"] }"}' \
  "$VAULT_ADDR/v1/sys/policies/acl/demo-policy" | jq
```

Expected response (empty, success):

```json
{}
```

**List policies:**

```bash
curl -sS \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/sys/policies/acl" | jq
```

Expected response:

```json
{
  "request_id": "...",
  "data": {
    "keys": ["default", "demo-policy", "root"]
  }
}
```

**Delete a secret (soft-delete latest version):**

First, get the current version:

```bash
curl -sS \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/metadata/app/config" | jq '.data.current_version'
```

Then delete that version:

```bash
curl -sS -X POST \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"versions":[1]}' \
  "$VAULT_ADDR/v1/secret/delete/app/config" | jq
```

Expected response (empty, success):

```json
{}
```

### Step 4: Run the MCP Server

Using the official published image:

```bash
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=hvs.localroot

docker run -i --rm \
  --network host \
  -e VAULT_ADDR=$VAULT_ADDR \
  -e VAULT_TOKEN=$VAULT_TOKEN \
  ashgw/vault-mcp:latest
```

Or build and run from source:

```bash
docker build -t vault-mcp .

docker run -i --rm \
  --network host \
  -e VAULT_ADDR=$VAULT_ADDR \
  -e VAULT_TOKEN=$VAULT_TOKEN \
  vault-mcp
```

> **Note:** The `--network host` flag lets the container access Vault on `127.0.0.1:8200`. If you're on Mac/Windows, use `host.docker.internal:8200` instead and update `VAULT_ADDR` accordingly.

The server runs via stdio and waits for an MCP client connection (Cursor, etc.). Without a client connected, it will appear idle.

### Step 5: Clean Up

Stop and remove the Vault container:

```bash
docker stop vault-dev
docker rm vault-dev
```

---

## Using Your Own Vault Server

If you already have a Vault server running, just point the MCP server at it:

```bash
docker run -i --rm \
  -e VAULT_ADDR=https://your-vault-server:8200 \
  -e VAULT_TOKEN=hvs.your-token \
  ashgw/vault-mcp:latest
```

Make sure:

- Your Vault has KV v2 enabled at `secret/` mount
- Your token has permissions to access `secret/` and `sys/policies/acl`

---

## Environment Variables

These are required to run the MCP Vault server:

- `VAULT_ADDR`: Your HashiCorp Vault server address (e.g., `http://127.0.0.1:8200`)
- `VAULT_TOKEN`: A valid Vault token with read/write permissions (must start with `hvs.`)
- `MCP_PORT`: Optional. Defaults to 3000. Not required for Cursor (uses stdio).

---

## Troubleshooting

- **Tools don't appear in client**: Ensure you're launching via an MCP client (like Cursor). All tools have descriptions and should appear.
- **KV mount not found**: Make sure KV v2 is enabled at `secret/` mount. Use the curl command in Step 2 above.
- **Token errors**: Token must start with `hvs.` and have permissions to access `secret/` mount and `sys/policies/acl`
- **Connection refused**: On Mac/Windows Docker, use `host.docker.internal:8200` instead of `127.0.0.1:8200` for `VAULT_ADDR`
- **TLS/SSL issues**: If using HTTPS with self-signed certificates, configure your environment accordingly

---

## License

[MIT](/LICENSE)
