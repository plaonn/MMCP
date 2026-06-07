import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

import { rmSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

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
  policyPath: `/tmp/mmcp-app-test-policy-${process.pid}.json`,
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
  getEmail: vi.fn(async (mailbox, uid) => ({
    mailbox,
    uid,
    messageId: "<message@example.com>",
    subject: "테스트 메일",
    from: ["sender@example.com"],
    to: ["user@example.com"],
    cc: [],
    replyTo: [],
    date: "2026-06-07T00:00:00.000Z",
    size: 1024,
    flags: [],
    hasAttachments: false,
    text: "본문",
    attachments: []
  })),
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

afterAll(() => {
  rmSync(config.policyPath, { force: true });
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

    const toolsList = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    });
    expect(toolsList.status).toBe(200);
    const toolsListResponse = await toolsList.json() as {
      result: { tools: Array<{ name: string }> };
    };
    expect(toolsListResponse.result.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "get_mail_rules",
        "preview_mail_rules_patch",
        "apply_mail_rules_patch",
        "get_mail_rules_history",
        "revert_mail_rules_revision"
      ])
    );
    expect(JSON.stringify(toolsListResponse)).not.toContain("policy");
    expect(JSON.stringify(toolsListResponse)).not.toContain("정책");

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

    const operations = Array.from({ length: 5 }, (_, index) => ({
      id: `move-${index + 1}`,
      mailbox: "INBOX",
      uid: index + 1,
      destinationMailbox: "Target"
    }));
    const bulkToolCall = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "move_emails", arguments: { operations } }
      })
    });
    expect(bulkToolCall.status).toBe(200);
    const bulkResponse = await bulkToolCall.json() as {
      result: {
        content: Array<{ type: string; text: string }>;
        structuredContent: unknown;
      };
    };
    expect(bulkResponse.result.structuredContent).toEqual({
      result: {
        attempted: 5,
        succeeded: 5,
        failed: 0,
        results: operations.map(({ id }) => ({ id, status: "succeeded" }))
      }
    });
    expect(bulkResponse.result.content).toHaveLength(1);
    expect(bulkResponse.result.content[0]?.text).not.toContain("\n");
    expect(JSON.parse(bulkResponse.result.content[0]?.text ?? "")).toEqual(
      bulkResponse.result.structuredContent
    );

    const readToolCall = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "get_emails",
          arguments: {
            operations: [
              { id: "read-inbox", mailbox: "INBOX", uid: 42 },
              { id: "read-other", mailbox: "Other", uid: 7 }
            ],
            textMaxChars: 2
          }
        }
      })
    });
    expect(readToolCall.status).toBe(200);
    const readResponse = await readToolCall.json() as {
      result: {
        content: Array<{ type: string; text: string }>;
        structuredContent: {
          result: {
            attempted: number;
            succeeded: number;
            failed: number;
            results: Array<Record<string, unknown>>;
          };
        };
      };
    };
    expect(readResponse.result.structuredContent).toMatchObject({
      result: {
        attempted: 2,
        succeeded: 2,
        failed: 0,
        results: [
          {
            id: "read-inbox",
            status: "succeeded",
            email: {
              mailbox: "INBOX",
              uid: 42,
              text: "본문",
              textLength: 2,
              textTruncated: false
            }
          },
          {
            id: "read-other",
            status: "succeeded",
            email: {
              mailbox: "Other",
              uid: 7,
              text: "본문",
              textLength: 2,
              textTruncated: false
            }
          }
        ]
      }
    });
    expect(readResponse.result.content[0]?.text).not.toContain("\n");
    expect(JSON.parse(readResponse.result.content[0]?.text ?? "")).toEqual(
      readResponse.result.structuredContent
    );
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
