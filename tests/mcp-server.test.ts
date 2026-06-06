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
  })),
  setEmailReadStatus: vi.fn(async (mailbox, uid, read) => ({
    mailbox,
    uid,
    read
  })),
  moveEmail: vi.fn(async (mailbox, uid, destinationMailbox) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox,
    destinationUid: 84
  })),
  archiveEmail: vi.fn(async (mailbox, uid) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox: "Archive",
    destinationUid: 84
  }))
};

describe("MCP tools", () => {
  it("조회 및 상태 관리 도구 일곱 개를 제공함", async () => {
    await withClient(async (client) => {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name).sort()).toEqual([
        "check_connection",
        "get_email",
        "list_mailboxes",
        "archive_email",
        "move_email",
        "set_email_read_status",
        "search_emails"
      ].sort());
      expect(
        result.tools.find((tool) => tool.name === "set_email_read_status")?.annotations
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      });
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

  it("읽음 상태 변경 입력을 email reader에 전달함", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "set_email_read_status",
        arguments: {
          mailbox: "INBOX",
          uid: 42,
          read: true
        }
      });

      expect(emailReader.setEmailReadStatus).toHaveBeenCalledWith("INBOX", 42, true);
      expect(result.structuredContent).toEqual({
        result: { mailbox: "INBOX", uid: 42, read: true }
      });
    });
  });

  it("이동 및 보관 입력을 email reader에 전달함", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "move_email",
        arguments: {
          mailbox: "INBOX",
          uid: 42,
          destinationMailbox: "Target"
        }
      });
      await client.callTool({
        name: "archive_email",
        arguments: {
          mailbox: "INBOX",
          uid: 43
        }
      });

      expect(emailReader.moveEmail).toHaveBeenCalledWith("INBOX", 42, "Target");
      expect(emailReader.archiveEmail).toHaveBeenCalledWith("INBOX", 43);
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
