# HashiCorp Vault MCP Server

HashiCorp Vault MCP Server is a full-featured Model Context Protocol (MCP) integration that lets language models and other MCP-aware clients manage Vault secrets and policies through a safe, auditable interface. It bridges Vault's security model with the structured interaction model that MCP expects, so you can automate tasks such as credential rotation, policy authoring, and discovery without exposing raw Vault APIs.

## Table of Contents

- [HashiCorp Vault MCP Server](#hashicorp-vault-mcp-server)
  - [Table of Contents](#table-of-contents)
  - [Introduction](#introduction)
  - [Why Use This Server](#why-use-this-server)
  - [How the Server Works](#how-the-server-works)
  - [Requirements](#requirements)
  - [Getting Started](#getting-started)
    - [Cursor](#cursor)
    - [Local Cursor](#local-cursor)
      - [Local Docker](#local-docker)
  - [Configuration](#configuration)
  - [Tool Reference](#tool-reference)
    - [`create_secret`](#create_secret)
    - [`read_secret`](#read_secret)
    - [`delete_secret`](#delete_secret)
    - [`create_policy`](#create_policy)
  - [Resource Reference](#resource-reference)
    - [`vault://secrets`](#vaultsecrets)
    - [`vault://policies`](#vaultpolicies)
  - [Prompt Reference](#prompt-reference)
    - [`generate_policy`](#generate_policy)
  - [Troubleshooting](#troubleshooting)
  - [License](#license)

## Introduction

The server wraps the HashiCorp Vault KV v2 API and common policy workflows inside MCP primitives. Once a client connects, it can call typed tools, browse resources, and request prompt completions that are all backed by the same Vault instance you already operate. Every interaction is explicit: clients must supply the paths, data, and policies they want to work with, and the server relays those requests directly to Vault using a token you control.

## Why Use This Server

- Automate secret rotation and retrieval directly from MCP-compatible IDEs and agents.
- Generate or update Vault ACL policies without manually editing HCL snippets.
- Safely expose only the operations you approve by scoping the Vault token that powers the server.
- Avoid ad-hoc scripting: the server comes with well-defined tools and prompts designed around common Vault tasks.

## How the Server Works

1. You launch the server either locally or inside a container with a Vault token.
2. An MCP client (Cursor, Claude Desktop, custom agents) connects over stdio.
3. The client calls tools like `create_secret` or `create_policy`; the server validates the payload, forwards it to Vault, and returns structured responses.
4. Resource requests such as `vault://secrets` list data-driven content that the client can browse or feed into follow-up prompts.
5. Prompt handlers like `generate_policy` help you synthesize Vault-ready HCL from natural-language intents.

The implementation is written in TypeScript, bundles to a single JavaScript file, and relies on the official `@modelcontextprotocol/sdk` for transport and schema validation.

## Requirements

- HashiCorp Vault 1.9+ with the KV secrets engine (v2) enabled on the paths you plan to manage.
- A Vault token that starts with `hvs.` and grants the capabilities you need (read, create, update, delete and/or sudo for policy work).
- Docker 24+.
- Network access from the machine running the MCP server to your Vault cluster.

## Getting Started

### Cursor

Production (recommended) — use the official image. Paste this under `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "Vault": {
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

Cursor starts the container on-demand, wires stdio to the MCP transport, and tears it down once the session ends. Pin a tag (e.g. `ashgw/vault-mcp:1.x.y`) if you want a fixed version.

### Local Cursor

You can build & run locally & use it like this

```json
{
  "mcpServers": {
    "Vault": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--network=host",
        "-e",
        "VAULT_ADDR=http://127.0.0.1:8200",
        "-e",
        "VAULT_TOKEN=hvs.test-token-1234567890abcdef",
        "vault-mcp:local"
      ]
    }
  }
}
```

#### Local Docker

```bash
git clone https://github.com/rccyx/vault-mcp.git
cd vault-mcp
docker build -t vault-mcp:local .

docker run -i --rm \
  --network=host \
  -e VAULT_ADDR=http://127.0.0.1:8200 \
  -e VAULT_TOKEN=hvs.test-token-1234567890abcdef \
  vault-mcp:local
```

## Configuration

- `VAULT_ADDR` (required): URL of the Vault cluster, for example `https://vault.internal:8200` or `http://127.0.0.1:8200`.
- `VAULT_TOKEN` (required): Short-lived or renewable Vault token starting with `hvs.`. Scope it tightly using Vault policies.
- `NODE_TLS_REJECT_UNAUTHORIZED` (optional): Set to `0` only for testing with self-signed certificates. Prefer adding proper CA bundles instead.

Provide any additional Vault environment variables (such as `VAULT_NAMESPACE`) if your deployment requires them; the server forwards the process environment to the Vault client library.

> For sane testing defaults locally use the `.env.copy.example` file.

## Tool Reference

The MCP server exposes tools that map directly to Vault operations. Payloads are validated before they are sent to Vault, and responses mirror Vault's JSON structure.

### `create_secret`

- **Purpose**: Write or update a secret at a KV v2 path.
- **Input**:
  - `path` (string): KV v2 logical path, for example `apps/myapp/config`.
  - `data` (object): Key/value pairs to store under `data`.
- **Response**: Returns the Vault write response including version metadata.

```ts
await tool("create_secret", {
  path: "apps/myapp/config",
  data: {
    apiKey: "secret-key-123",
    environment: "production",
  },
});
```

### `read_secret`

- **Purpose**: Retrieve a specific secret version from KV v2.
- **Input**:
  - `path` (string): KV v2 logical path.
  - `version` (optional number): Explicit version to fetch; defaults to latest.
- **Response**: Vault `data` object along with metadata (`created_time`, `version`).

```ts
const secret = await tool("read_secret", { path: "apps/myapp/config" });
console.log(secret.data.apiKey);
```

### `delete_secret`

- **Purpose**: Soft-delete the latest version of a KV v2 secret.
- **Input**:
  - `path` (string): KV v2 logical path.
- **Response**: Vault deletion metadata. Older versions remain unless destroyed separately.

```ts
await tool("delete_secret", { path: "apps/myapp/config" });
```

### `create_policy`

- **Purpose**: Create or replace a Vault ACL policy.
- **Input**:
  - `name` (string): Policy name to upsert.
  - `policy` (string): HCL policy definition.
- **Response**: `true` on success.

```ts
await tool("create_policy", {
  name: "app-readonly",
  policy: """
path "secret/data/apps/myapp/*" {
  capabilities = ["read", "list"]
}
"""
});
```

## Resource Reference

Resources expose browsable datasets that help MCP clients decide which tool call to make next.

### `vault://secrets`

Lists the keys available at the root of the KV store. Nested directories end with `/` so clients can drill deeper.

```json
{
  "keys": ["apps/", "databases/", "certificates/"]
}
```

### `vault://policies`

Enumerates policy names the token can read. Useful for auditing or feeding into prompts.

```json
{
  "policies": ["default", "app-readonly", "admin"]
}
```

## Prompt Reference

Prompts assist with higher-level authoring tasks by turning structured input into Vault-friendly output.

### `generate_policy`

- **Input**:
  - `path` (string): Target KV path or pattern, such as `secret/data/apps/*`.
  - `capabilities` (string): Comma-separated capabilities (for example `read,list,delete`).
- **Response**: JSON object that maps paths to capability arrays so you can embed the result into an ACL policy or feed it back into `create_policy`.

```ts
const draft = await prompt("generate_policy", {
  path: "secret/data/apps/*",
  capabilities: "read,list",
});
```

## Troubleshooting

- **Authentication failed**: Confirm `VAULT_TOKEN` is valid and not revoked. Run `vault token lookup hvs.your-token` to inspect TTL and policies.
- **Permission denied for a path**: Adjust the Vault policy attached to your token or verify you are targeting the correct mount (for example `secret/data/...` versus `kv/data/...`).
- **Self-signed certificate errors**: Supply a CA bundle via `VAULT_CACERT` or temporarily set `NODE_TLS_REJECT_UNAUTHORIZED=0` while testing.
- **Resources look empty**: The token only sees paths it is permitted to `list`. Double-check the policy allows the `list` capability on the relevant prefixes.

## License

Distributed under the [MIT License](LICENSE).
