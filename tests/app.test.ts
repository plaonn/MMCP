import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { EmailReader } from "../src/email/types.js";

const config: Config = {
  host: "127.0.0.1",
  port: 3000,
  publicUrl: new URL("https://mail.example.com/mcp"),
  oauth: {
    ownerPassword: "owner-password-value",
    signingSecret: "s".repeat(32)
  },
  imap: {
    host: "imap.naver.com",
    port: 993,
    secure: true,
    user: "user@naver.com",
    password: "secret"
  },
  maxEmailBytes: 5 * 1024 * 1024
};

const emailReader: EmailReader = {
  checkConnection: vi.fn(async () => ({ connected: true as const })),
  getServerCapabilities: vi.fn(async () => ({
    capabilities: [],
    specialUses: [],
    features: { idle: false, move: false, quota: false, sort: false, thread: false }
  })),
  getQuota: vi.fn(async (mailbox) => ({ supported: false, mailbox })),
  listMailboxes: vi.fn(async () => []),
  searchEmails: vi.fn(async () => []),
  getEmail: vi.fn(async () => {
    throw new Error("사용하지 않음");
  }),
  getEmailHeaders: vi.fn(async (mailbox, uid) => ({ mailbox, uid, headers: "" })),
  getEmailSource: vi.fn(async (mailbox, uid) => ({ mailbox, uid, source: "" })),
  setEmailReadStatus: vi.fn(async (mailbox, uid, read) => ({ mailbox, uid, read })),
  setEmailFlaggedStatus: vi.fn(async (mailbox, uid, flagged) => ({
    mailbox,
    uid,
    flagged
  })),
  copyEmail: vi.fn(async (mailbox, uid, destinationMailbox) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox,
    destinationUid: null
  })),
  moveEmail: vi.fn(async (mailbox, uid, destinationMailbox) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox,
    destinationUid: null
  })),
  trashEmail: vi.fn(async (mailbox, uid) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox: "Trash",
    destinationUid: null
  })),
  markEmailAsSpam: vi.fn(async (mailbox, uid) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox: "Spam",
    destinationUid: null
  })),
  createMailbox: vi.fn(async (path) => ({ path, created: true })),
  renameMailbox: vi.fn(async (path, newPath) => ({ path, newPath })),
  setMailboxSubscription: vi.fn(async (path, subscribed) => ({ path, subscribed }))
};

const servers: Array<ReturnType<ReturnType<typeof createApp>["listen"]>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe("HTTP app", () => {
  it("health endpoint를 인증 없이 제공함", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("인증되지 않은 MCP 요청을 거부함", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mail.example.com/.well-known/oauth-protected-resource/mcp"'
    );
  });

  it("잘못된 bearer token을 프로토콜 오류 응답으로 거부함", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(await response.json()).toMatchObject({ error: "invalid_token" });
  });

  it("MCP 요청을 client IP별로 제한함", async () => {
    const baseUrl = await startServer();
    const requests = Array.from({ length: 121 }, () =>
      fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      })
    );

    const responses = await Promise.all(requests);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(120);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it("OAuth discovery metadata를 제공함", async () => {
    const baseUrl = await startServer();

    const protectedResource = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`
    );
    expect(await protectedResource.json()).toMatchObject({
      resource: "https://mail.example.com/mcp",
      authorization_servers: ["https://mail.example.com/"],
      scopes_supported: ["mail.read", "mail.modify"]
    });

    const authorizationServer = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server`
    );
    expect(await authorizationServer.json()).toMatchObject({
      issuer: "https://mail.example.com/",
      registration_endpoint: "https://mail.example.com/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"]
    });
  });

  it("DCR과 authorization-code PKCE로 access token을 발급함", async () => {
    const baseUrl = await startServer();
    const client = await registerClient(baseUrl);
    const verifier = "v".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorization = new URL(`${baseUrl}/authorize`);
    authorization.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://chatgpt.com/connector/oauth/test",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "mail.read mail.modify",
      state: "test-state",
      resource: "https://mail.example.com/mcp"
    }).toString();

    const approvalPage = await fetch(authorization);
    expect(approvalPage.status).toBe(200);
    expect(await approvalPage.text()).toContain("MMCP 연결 승인");

    const approval = await fetch(`${baseUrl}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...Object.fromEntries(authorization.searchParams),
        owner_password: config.oauth.ownerPassword
      })
    });
    expect(approval.status).toBe(302);
    const redirect = new URL(approval.headers.get("location") ?? "");
    expect(redirect.searchParams.get("state")).toBe("test-state");

    const tokenResponse = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: redirect.searchParams.get("code") ?? "",
        code_verifier: verifier,
        redirect_uri: "https://chatgpt.com/connector/oauth/test",
        resource: "https://mail.example.com/mcp"
      })
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      scope: string;
    };
    expect(tokens.scope).toBe("mail.read mail.modify");
    expect(tokens.refresh_token).toBeTypeOf("string");

    const refreshedResponse = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        scope: "mail.read",
        resource: "https://mail.example.com/mcp"
      })
    });
    expect(refreshedResponse.status).toBe(200);
    expect(await refreshedResponse.json()).toMatchObject({ scope: "mail.read" });

    const authenticatedMcp = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });
    expect(authenticatedMcp.status).not.toBe(401);

    const toolCall = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "check_connection", arguments: {} }
      })
    });
    expect(toolCall.status).toBe(200);
    expect(await toolCall.json()).toMatchObject({
      result: {
        structuredContent: {
          result: { connected: true }
        }
      }
    });
  });
});

async function registerClient(baseUrl: string): Promise<{ client_id: string }> {
  const response = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "ChatGPT test"
    })
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ client_id: string }>;
}

async function startServer(): Promise<string> {
  const app = createApp(config, emailReader);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
