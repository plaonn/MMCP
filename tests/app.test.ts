import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { EmailReader } from "../src/email/types.js";

const bearerToken = "t".repeat(24);
const config: Config = {
  host: "127.0.0.1",
  port: 3000,
  bearerToken,
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
  checkConnection: vi.fn(async () => ({
    connected: true as const,
    user: "user@naver.com"
  })),
  listMailboxes: vi.fn(async () => []),
  searchEmails: vi.fn(async () => []),
  getEmail: vi.fn(async () => {
    throw new Error("사용하지 않음");
  }),
  setEmailReadStatus: vi.fn(async (mailbox, uid, read) => ({ mailbox, uid, read })),
  moveEmail: vi.fn(async (mailbox, uid, destinationMailbox) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox,
    destinationUid: null
  }))
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
  });
});

async function startServer(): Promise<string> {
  const app = createApp(config, emailReader);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
