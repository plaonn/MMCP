import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import type { EmailReader } from "../src/email/types.js";
import { createMcpServer } from "../src/mcp-server.js";
import { PolicyStore } from "../src/policy-store.js";

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
        "apply_mail_policy_patch",
        "check_connection",
        "copy_emails",
        "create_mailbox",
        "get_email",
        "get_email_headers",
        "get_email_source",
        "get_bulk_operation_diagnostics",
        "get_quota",
        "get_server_capabilities",
        "get_mail_policy",
        "get_mail_policy_history",
        "list_mailboxes",
        "mark_emails_as_spam",
        "move_emails",
        "preview_mail_policy_patch",
        "rename_mailbox",
        "revert_mail_policy_revision",
        "set_emails_flagged_status",
        "set_emails_read_status",
        "set_mailbox_subscription",
        "search_emails",
        "trash_emails"
      ].sort());
      expect(result.tools.some((tool) => tool.name.includes("delete"))).toBe(false);
      expect(result.tools.find((tool) => tool.name === "trash_emails")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      });
      expect(
        result.tools.find((tool) => tool.name === "set_emails_read_status")?.annotations
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      });
      expect(result.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
      const bulkToolNames = [
        "copy_emails",
        "mark_emails_as_spam",
        "move_emails",
        "set_emails_flagged_status",
        "set_emails_read_status",
        "trash_emails"
      ];
      const moveOutputSchema = result.tools.find((tool) => tool.name === "move_emails")?.outputSchema;
      expect(moveOutputSchema).toBeDefined();
      for (const toolName of bulkToolNames) {
        expect(result.tools.find((tool) => tool.name === toolName)?.outputSchema).toEqual(
          moveOutputSchema
        );
      }
      expect(result.tools.find((tool) => tool.name === "search_emails")?._meta).toEqual({
        securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }]
      });
      expect(
        result.tools.find((tool) => tool.name === "set_emails_read_status")?._meta
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

  it("여러 읽음 상태 변경을 한 호출에서 처리하고 작업별 성공을 반환함", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "set_emails_read_status",
        arguments: {
          operations: [
            { id: "read-inbox", mailbox: "INBOX", uid: 42, read: true },
            { id: "unread-other", mailbox: "Other", uid: 7, read: false }
          ]
        }
      });

      expect(emailReader.setEmailReadStatus).toHaveBeenCalledWith("INBOX", 42, true);
      expect(emailReader.setEmailReadStatus).toHaveBeenCalledWith("Other", 7, false);
      expect(result.structuredContent).toEqual({
        result: {
          attempted: 2,
          succeeded: 2,
          failed: 0,
          results: [
            { id: "read-inbox", status: "succeeded" },
            { id: "unread-other", status: "succeeded" }
          ]
        }
      });
    });
  });

  it("여러 이동을 처리하고 개별 실패 후 다음 작업을 계속함", async () => {
    await withClient(async (client) => {
      vi.mocked(emailReader.moveEmail)
        .mockRejectedValueOnce(new Error("대상 편지함을 찾을 수 없음"))
        .mockResolvedValueOnce({
          sourceMailbox: "Other",
          sourceUid: 7,
          destinationMailbox: "Target",
          destinationUid: 9
        });

      const result = await client.callTool({
        name: "move_emails",
        arguments: {
          operations: [
            { id: "missing-target", mailbox: "INBOX", uid: 42, destinationMailbox: "Missing" },
            { id: "move-other", mailbox: "Other", uid: 7, destinationMailbox: "Target" }
          ]
        }
      });
      expect(emailReader.moveEmail).toHaveBeenCalledWith("INBOX", 42, "Missing");
      expect(emailReader.moveEmail).toHaveBeenCalledWith("Other", 7, "Target");
      expect(result.structuredContent).toEqual({
        result: {
          attempted: 2,
          succeeded: 1,
          failed: 1,
          results: [
            {
              id: "missing-target",
              status: "failed",
              code: "MAILBOX_NOT_FOUND",
              error: "대상 편지함을 찾을 수 없음"
            },
            {
              id: "move-other",
              status: "succeeded"
            }
          ]
        }
      });
    });
  });

  it("벌크 이동 응답은 구조화 응답과 같은 완전한 단일행 JSON 텍스트를 반환함", async () => {
    await withClient(async (client) => {
      const operations = Array.from({ length: 5 }, (_, index) => ({
        id: `move-${index + 1}`,
        mailbox: "INBOX",
        uid: index + 1,
        destinationMailbox: "Target"
      }));
      const result = await client.callTool({
        name: "move_emails",
        arguments: { operations }
      });

      expect(result.structuredContent).toEqual({
        result: {
          attempted: 5,
          succeeded: 5,
          failed: 0,
          results: operations.map(({ id }) => ({ id, status: "succeeded" }))
        }
      });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content).toHaveLength(1);
      expect(content[0]).toMatchObject({ type: "text" });

      const text = content[0]?.type === "text" ? content[0].text ?? "" : "";
      expect(text).not.toContain("\n");
      expect(text).not.toContain("display_url");
      expect(text).not.toContain("display_title");
      expect(text).not.toContain('"..."');
      expect(JSON.parse(text)).toEqual(result.structuredContent);
    });
  });

  it("여러 휴지통과 스팸 처리를 별도 도구로 전달함", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "trash_emails",
        arguments: {
          operations: [
            { id: "trash-inbox", mailbox: "INBOX", uid: 42 },
            { id: "trash-other", mailbox: "Other", uid: 7 }
          ]
        }
      });
      await client.callTool({
        name: "mark_emails_as_spam",
        arguments: { operations: [{ id: "spam-inbox", mailbox: "INBOX", uid: 43 }] }
      });

      expect(emailReader.trashEmail).toHaveBeenCalledWith("INBOX", 42);
      expect(emailReader.trashEmail).toHaveBeenCalledWith("Other", 7);
      expect(emailReader.markEmailAsSpam).toHaveBeenCalledWith("INBOX", 43);
    });
  });

  it("중복 작업 id와 동일 이메일 중복 지정을 실행 전에 거부함", async () => {
    await withClient(async (client) => {
      const before = vi.mocked(emailReader.setEmailReadStatus).mock.calls.length;
      const result = await client.callTool({
        name: "set_emails_read_status",
        arguments: {
          operations: [
            { id: "duplicate", mailbox: "INBOX", uid: 42, read: true },
            { id: "duplicate", mailbox: "INBOX", uid: 42, read: false }
          ]
        }
      });

      expect(result.isError).toBe(true);
      expect(vi.mocked(emailReader.setEmailReadStatus).mock.calls).toHaveLength(before);
    });
  });

  it("복사는 같은 이메일을 서로 다른 목적지로 복사할 수 있음", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "copy_emails",
        arguments: {
          operations: [
            { id: "copy-a", mailbox: "INBOX", uid: 42, destinationMailbox: "A" },
            { id: "copy-b", mailbox: "INBOX", uid: 42, destinationMailbox: "B" }
          ]
        }
      });

      expect(result.structuredContent).toMatchObject({
        result: { attempted: 2, succeeded: 2, failed: 0 }
      });
    });
  });

  it("최근 벌크 작업 진단에는 개인정보 없이 실행 요약만 반환함", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "move_emails",
        arguments: {
          operations: [{
            id: "diagnostic-operation",
            mailbox: "INBOX",
            uid: 42,
            destinationMailbox: "Target"
          }]
        }
      });
      const diagnostics = await client.callTool({
        name: "get_bulk_operation_diagnostics",
        arguments: {}
      });

      const entries = (diagnostics.structuredContent as {
        result: Array<Record<string, unknown>>;
      }).result;
      expect(entries).toContainEqual(expect.objectContaining({
        tool: "move_emails",
        phase: "completed",
        attempted: 1,
        succeeded: 1,
        failed: 0
      }));
      expect(JSON.stringify(diagnostics.structuredContent)).not.toContain("INBOX");
      expect(JSON.stringify(diagnostics.structuredContent)).not.toContain("diagnostic-operation");
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

  it("정책을 조회하고 patch를 미리 본 뒤 적용함", async () => {
    await withClient(async (client) => {
      expect(client.getInstructions()).toContain("현재 메일 관리 정책 revision 1");
      expect(client.getInstructions()).toContain("ask-when-uncertain");

      const current = await client.callTool({
        name: "get_mail_policy",
        arguments: {}
      });
      expect(current.structuredContent).toMatchObject({
        result: { revision: 1 }
      });

      const patch = {
        expectedRevision: 1,
        operations: [{
          operation: "add",
          rule: { id: "protect-personal", text: "개인 메일은 신중하게 처리함." }
        }]
      };
      const preview = await client.callTool({
        name: "preview_mail_policy_patch",
        arguments: patch
      });
      expect(preview.structuredContent).toMatchObject({
        result: { currentRevision: 1, nextRevision: 2 }
      });

      const applied = await client.callTool({
        name: "apply_mail_policy_patch",
        arguments: patch
      });
      expect(applied.structuredContent).toMatchObject({
        result: { currentRevision: 1, nextRevision: 2 }
      });
      expect(
        (await client.callTool({
          name: "get_mail_policy_history",
          arguments: { limit: 10 }
        })).structuredContent
      ).toMatchObject({
        result: [{ revision: 2 }, { revision: 1 }]
      });
    });
  });
});

async function withClient(operation: (client: Client) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mmcp-mcp-policy-test-"));
  const server = createMcpServer(emailReader, {
    policyStore: new PolicyStore(join(directory, "policy.json"))
  });
  const client = new Client({ name: "mmcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await operation(client);
  } finally {
    await client.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
