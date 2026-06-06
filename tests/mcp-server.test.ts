import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import type { EmailReader } from "../src/email/types.js";
import { createMcpServer } from "../src/mcp-server.js";

const emailReader: EmailReader = {
  checkConnection: vi.fn(async () => ({ connected: true as const })),
  getServerCapabilities: vi.fn(async () => ({
    capabilities: ["MOVE", "QUOTA"],
    specialUses: ["\\Inbox", "\\Trash"],
    features: { idle: false, move: true, quota: true, sort: false, thread: false }
  })),
  getQuota: vi.fn(async (mailbox) => ({ supported: true, mailbox })),
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
  getEmailHeaders: vi.fn(async (mailbox, uid) => ({ mailbox, uid, headers: "Subject: test" })),
  getEmailSource: vi.fn(async (mailbox, uid) => ({ mailbox, uid, source: "Subject: test\n\nbody" })),
  setEmailReadStatus: vi.fn(async (mailbox, uid, read) => ({
    mailbox,
    uid,
    read
  })),
  setEmailFlaggedStatus: vi.fn(async (mailbox, uid, flagged) => ({
    mailbox,
    uid,
    flagged
  })),
  copyEmail: vi.fn(async (mailbox, uid, destinationMailbox) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox,
    destinationUid: 84
  })),
  moveEmail: vi.fn(async (mailbox, uid, destinationMailbox) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox,
    destinationUid: 84
  })),
  trashEmail: vi.fn(async (mailbox, uid) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox: "Trash",
    destinationUid: 84
  })),
  markEmailAsSpam: vi.fn(async (mailbox, uid) => ({
    sourceMailbox: mailbox,
    sourceUid: uid,
    destinationMailbox: "Spam",
    destinationUid: 84
  })),
  createMailbox: vi.fn(async (path) => ({ path, created: true })),
  renameMailbox: vi.fn(async (path, newPath) => ({ path, newPath })),
  setMailboxSubscription: vi.fn(async (path, subscribed) => ({ path, subscribed }))
};

describe("MCP tools", () => {
  it("조회 및 상태 관리 도구를 제공하고 영구 삭제 도구는 제공하지 않음", async () => {
    await withClient(async (client) => {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name).sort()).toEqual([
        "check_connection",
        "copy_email",
        "create_mailbox",
        "get_email",
        "get_email_headers",
        "get_email_source",
        "get_quota",
        "get_server_capabilities",
        "list_mailboxes",
        "mark_email_as_spam",
        "move_email",
        "rename_mailbox",
        "set_email_flagged_status",
        "set_email_read_status",
        "set_mailbox_subscription",
        "search_emails",
        "trash_email"
      ].sort());
      expect(result.tools.some((tool) => tool.name.includes("delete"))).toBe(false);
      expect(result.tools.find((tool) => tool.name === "trash_email")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      });
      expect(
        result.tools.find((tool) => tool.name === "set_email_read_status")?.annotations
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      });
      expect(result.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
      expect(result.tools.find((tool) => tool.name === "search_emails")?._meta).toEqual({
        securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }]
      });
      expect(
        result.tools.find((tool) => tool.name === "set_email_read_status")?._meta
      ).toEqual({
        securitySchemes: [{ type: "oauth2", scopes: ["mail.modify"] }]
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

  it("이동 입력을 email reader에 전달함", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "move_email",
        arguments: {
          mailbox: "INBOX",
          uid: 42,
          destinationMailbox: "Target"
        }
      });
      expect(emailReader.moveEmail).toHaveBeenCalledWith("INBOX", 42, "Target");
    });
  });

  it("휴지통과 스팸 처리를 별도 도구로 전달함", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "trash_email",
        arguments: { mailbox: "INBOX", uid: 42 }
      });
      await client.callTool({
        name: "mark_email_as_spam",
        arguments: { mailbox: "INBOX", uid: 43 }
      });

      expect(emailReader.trashEmail).toHaveBeenCalledWith("INBOX", 42);
      expect(emailReader.markEmailAsSpam).toHaveBeenCalledWith("INBOX", 43);
    });
  });

  it("편지함 관리 입력을 email reader에 전달함", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "create_mailbox",
        arguments: { path: "Projects" }
      });
      await client.callTool({
        name: "rename_mailbox",
        arguments: { path: "Projects", newPath: "Archive Projects" }
      });
      await client.callTool({
        name: "set_mailbox_subscription",
        arguments: { path: "Archive Projects", subscribed: false }
      });

      expect(emailReader.createMailbox).toHaveBeenCalledWith("Projects");
      expect(emailReader.renameMailbox).toHaveBeenCalledWith("Projects", "Archive Projects");
      expect(emailReader.setMailboxSubscription).toHaveBeenCalledWith(
        "Archive Projects",
        false
      );
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
