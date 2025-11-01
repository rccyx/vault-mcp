import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createEnv } from "envyx";

type Kv2ReadResponse = {
  data: {
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    keys?: string[];
    current_version?: number;
  };
};

type ListResponse = { data: { keys?: string[] } };

type VaultClient = {
  write: (
    path: string,
    payload: { data?: Record<string, unknown> }
  ) => Promise<unknown>;
  readKv2: (path: string) => Promise<Kv2ReadResponse>;
  delete: (path: string) => Promise<unknown>;
  list: (path: string) => Promise<ListResponse>;
  sys: {
    addPolicy: (args: { name: string; policy: string }) => Promise<unknown>;
    listPolicies: () => Promise<unknown>;
  };
};

class HttpVaultClient implements VaultClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async request<T>(
    method: string,
    apiPath: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/v1/${apiPath}`;
    const response = await fetch(url, {
      method,
      headers: {
        "X-Vault-Token": this.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `${method} ${apiPath} failed with ${response.status}`;
      try {
        const errJson = (await response.json()) as { errors?: string[] };
        if (errJson?.errors?.length)
          message += `: ${errJson.errors.join("; ")}`;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    if (response.status === 204) {
      // No Content
      return undefined as unknown as T;
    }
    return (await response.json()) as T;
  }

  async write(path: string, payload: { data?: Record<string, unknown> }) {
    // Expecting paths like "secret/data/foo"
    return this.request("POST", path, payload);
  }

  async readKv2(path: string): Promise<Kv2ReadResponse> {
    // Expecting paths like "secret/data/<relative>"
    return this.request<Kv2ReadResponse>("GET", path);
  }

  async delete(path: string): Promise<unknown> {
    // For KV v2, soft-delete requires POST to secret/delete/{path} with versions[]
    // If path is "secret/data/<p>", compute latest version from metadata
    if (path.startsWith("secret/data/")) {
      const relative = path.substring("secret/data/".length);
      const meta = await this.request<Kv2ReadResponse>(
        "GET",
        `secret/metadata/${relative}`
      );
      const currentVersion = (meta.data as { current_version?: number })
        .current_version;
      if (!currentVersion) {
        // Fallback: delete metadata and all versions if we cannot determine version
        return this.request("DELETE", `secret/metadata/${relative}`);
      }
      return this.request("POST", `secret/delete/${relative}`, {
        versions: [currentVersion],
      });
    }
    // Otherwise try DELETE against provided path
    return this.request("DELETE", path);
  }

  async list(path: string): Promise<ListResponse> {
    // Use ?list=true which is widely supported over raw LIST
    const listPath = path.endsWith("/") ? path.slice(0, -1) : path;
    return this.request("GET", `${listPath}?list=true`);
  }

  sys = {
    addPolicy: async ({ name, policy }: { name: string; policy: string }) => {
      return this.request(
        "PUT",
        `sys/policies/acl/${encodeURIComponent(name)}`,
        { policy }
      );
    },
    listPolicies: async () => {
      return this.request("GET", "sys/policies/acl");
    },
  };
}

class VaultMcpServer {
  private server: McpServer;
  private vaultClient: VaultClient;

  constructor(vaultAddress: string, vaultToken: string) {
    this.server = new McpServer({
      name: "vault-mcp",
      version: "1.0.0",
      description:
        "MCP server for HashiCorp Vault secret and policy operations",
    });

    this.vaultClient = new HttpVaultClient(vaultAddress, vaultToken);

    this.registerTools();
    this.registerResources();
    this.registerPrompts();
  }

  private registerTools() {
    this.server.tool(
      "create_secret",
      "Create or update a secret at secret/data/{path} in Vault KV v2.",
      { path: z.string(), data: z.record(z.unknown()) },
      async (args) => {
        const { path, data } = args;
        const result = await this.vaultClient.write(`secret/data/${path}`, {
          data,
        });
        return {
          content: [
            {
              type: "text",
              text: `Secret written at: ${path}\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }
    );

    this.server.tool(
      "read_secret",
      "Read a secret at secret/data/{path} from Vault KV v2.",
      { path: z.string() },
      async (args) => {
        const { path } = args;
        const result = await this.vaultClient.readKv2(`secret/data/${path}`);
        const payload = result.data?.data ?? {};
        return {
          content: [
            {
              type: "text",
              text: `Secret read at: ${path}\n${JSON.stringify(payload, null, 2)}`,
            },
          ],
        };
      }
    );

    this.server.tool(
      "delete_secret",
      "Soft-delete the latest version of a secret at secret/data/{path} (KV v2).",
      { path: z.string() },
      async (args) => {
        const { path } = args;
        const result = await this.vaultClient.delete(`secret/data/${path}`);
        return {
          content: [
            {
              type: "text",
              text: `Secret deleted at: ${path}\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }
    );

    this.server.tool(
      "create_policy",
      "Create or replace a Vault policy with the given name and HCL policy string.",
      { name: z.string(), policy: z.string() },
      async (args) => {
        const { name, policy } = args;
        const result = await this.vaultClient.sys.addPolicy({ name, policy });
        return {
          content: [
            {
              type: "text",
              text: `Policy '${name}' created.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }
    );
  }

  private registerResources() {
    this.server.resource("vault_secrets", "vault://secrets", async () => {
      try {
        const result = await this.vaultClient.list("secret/metadata");
        return {
          contents: [
            {
              uri: "vault://secrets",
              text: JSON.stringify(result.data.keys ?? []),
            },
          ],
        };
      } catch (_err) {
        return {
          contents: [
            {
              uri: "vault://secrets",
              text: "[]",
            },
          ],
        };
      }
    });

    this.server.resource("vault_policies", "vault://policies", async () => {
      const result = await this.vaultClient.sys.listPolicies();
      return {
        contents: [
          {
            uri: "vault://policies",
            text: JSON.stringify(result),
          },
        ],
      };
    });
  }

  private registerPrompts() {
    this.server.prompt(
      "generate_policy",
      {
        path: z.string(),
        capabilities: z.string(),
      },
      async ({ path, capabilities }) => {
        const capArray = capabilities.split(",").map((c) => c.trim());
        const policy = { path: { [path]: { capabilities: capArray } } };
        return {
          messages: [
            {
              role: "user",
              content: { type: "text", text: JSON.stringify(policy, null, 2) },
            },
          ],
        };
      }
    );
  }

  public async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("vault mcp server running via stdio");
  }
}

export default VaultMcpServer;

async function main() {
  const env = createEnv({
    vars: {
      VAULT_ADDR: z.string().url({
        message:
          "VAULT_ADDR must be a valid URL (e.g., http://vault.example.com:8200)",
      }),
      VAULT_TOKEN: z.string().min(3).startsWith("hvs.", {
        message:
          "VAULT_TOKEN must start with 'hvs.' prefix for HashiCorp Vault tokens",
      }),
      MCP_PORT: z.coerce
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional()
        .default(3000),
    },
  });

  try {
    const server = new VaultMcpServer(env.VAULT_ADDR, env.VAULT_TOKEN);
    await server.start();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
