import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import type { EmailReader } from "../src/email/types.js";
import { createMcpServer } from "../src/mcp-server.js";

const emailReader: EmailReader = {
  checkConnection: vi.fn(async () => ({
    connected: true as const,
    user: "user@naver.com"
  })),
  listMailboxes: vi.fn(async () => [
    {
      path: "INBOX",
      name: "INBOX",
      specialUse: "\\Inbox",
      subscribed: true
    }
  ]),
  searchEmails: vi.fn(async ({ mailbox }) => [
    {
      mailbox,
      uid: 42,
      messageId: "<message@example.com>",
      subject: "테스트 메일",
      from: ["sender@example.com"],
      to: ["user@naver.com"],
      date: "2026-06-06T00:00:00.000Z",
      size: 1024,
      flags: [],
      hasAttachments: false
    }
  ]),
  getEmail: vi.fn(async (mailbox, uid) => ({
    mailbox,
    uid,
    messageId: "<message@example.com>",
    subject: "테스트 메일",
    from: ["sender@example.com"],
    to: ["user@naver.com"],
    cc: [],
    replyTo: [],
    date: "2026-06-06T00:00:00.000Z",
    size: 1024,
    flags: [],
    hasAttachments: false,
    text: "본문",
    attachments: []
  }))
};

describe("MCP tools", () => {
  it("읽기 전용 도구 네 개를 제공함", async () => {
    await withClient(async (client) => {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name).sort()).toEqual([
        "check_connection",
        "get_email",
        "list_mailboxes",
        "search_emails"
      ]);
    });
  });

  it("검색 도구 입력을 email reader에 전달함", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "search_emails",
        arguments: {
          mailbox: "INBOX",
          subject: "테스트",
          limit: 10
        }
      });

      expect(emailReader.searchEmails).toHaveBeenCalledWith({
        mailbox: "INBOX",
        subject: "테스트",
        limit: 10
      });
      expect(result.structuredContent).toMatchObject({
        result: [{ uid: 42, subject: "테스트 메일" }]
      });
    });
  });
});

async function withClient(operation: (client: Client) => Promise<void>): Promise<void> {
  const server = createMcpServer(emailReader);
  const client = new Client({ name: "mmcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await operation(client);
  } finally {
    await client.close();
    await server.close();
  }
}
