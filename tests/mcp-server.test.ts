import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { SqliteBulkJournalStore } from "../src/bulk-journal/sqlite-bulk-journal-store.js";
import type { EmailReader } from "../src/email/types.js";
import { SqliteLedgerStore } from "../src/ledger/sqlite-ledger-store.js";
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
  getMailboxStatus: vi.fn(async (mailbox) => ({
    mailbox,
    uidValidity: "123",
    uidValidityUsable: true,
    uidNext: 43,
    exists: 10,
    highestModseq: "999"
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
  getEmailHeaders: vi.fn(async (mailbox, uid) => ({ mailbox, uid, headers: "Subject: test" })),
  getEmailSource: vi.fn(async (mailbox, uid) => ({ mailbox, uid, source: "Subject: test\n\nbody" })),
  getEmailState: vi.fn(async (mailbox, uid) => ({
    mailbox,
    uid,
    read: false,
    flagged: false
  })),
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

function emailReaderCallCounts(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(emailReader).map(([name, mock]) => [
      name,
      vi.mocked(mock).mock.calls.length
    ])
  );
}

describe("MCP tools", () => {
  it("조회 및 상태 관리 도구를 제공하고 영구 삭제 도구는 제공하지 않음", async () => {
    await withClient(async (client) => {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name).sort()).toEqual([
        "apply_mail_rules_patch",
        "check_connection",
        "copy_emails",
        "create_mailbox",
        "get_email",
        "get_emails",
        "get_email_headers",
        "get_email_source",
        "get_mail_action",
        "get_mailbox_status",
        "get_bulk_operation_diagnostics",
        "get_bulk_operation_status",
        "get_quota",
        "get_server_capabilities",
        "get_mail_rules",
        "get_mail_rules_history",
        "get_todoist_export_candidates",
        "list_mailboxes",
        "mark_emails_as_spam",
        "move_emails",
        "preview_mail_rules_patch",
        "record_mail_action_candidates",
        "record_mail_action_location",
        "record_todoist_sync_results",
        "rename_mailbox",
        "resume_bulk_operation",
        "revert_mail_rules_revision",
        "search_mail_actions",
        "set_emails_flagged_status",
        "set_emails_read_status",
        "set_mailbox_subscription",
        "search_emails",
        "trash_emails",
        "update_mail_actions",
        "upsert_mail_actions"
      ].sort());
      expect(JSON.stringify(result.tools)).not.toContain("policy");
      expect(JSON.stringify(result.tools)).not.toContain("정책");
      expect(result.tools.some((tool) => tool.name.includes("delete"))).toBe(false);
      expect(result.tools.find((tool) => tool.name === "trash_emails")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      });
      expect(
        result.tools.find((tool) => tool.name === "resume_bulk_operation")?.annotations
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true
      });
      expect(
        result.tools.find((tool) => tool.name === "set_emails_read_status")?.annotations
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      });
      expect(result.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
      expect(result.tools.find((tool) => tool.name === "get_emails")?.annotations).toMatchObject({
        readOnlyHint: true
      });
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
        const tool = result.tools.find((candidate) => candidate.name === toolName);
        expect(tool?.outputSchema).toEqual(moveOutputSchema);
        expect(tool?.inputSchema).toMatchObject({
          required: expect.arrayContaining(["bulkId", "operations"])
        });
      }
      expect(result.tools.find((tool) => tool.name === "search_emails")?._meta).toEqual({
        securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }]
      });
      expect(result.tools.find((tool) => tool.name === "search_emails")?.inputSchema)
        .toMatchObject({
          properties: {
            flagged: { type: "boolean" },
            minSize: { type: "integer", minimum: 0, maximum: 4_294_967_294 },
            maxSize: { type: "integer", minimum: 0, maximum: 4_294_967_294 },
            olderThanUid: { type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 }
          }
        });
      expect(result.tools.find((tool) => tool.name === "get_emails")?._meta).toEqual({
        securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }]
      });
      expect(
        result.tools.find((tool) => tool.name === "set_emails_read_status")?._meta
      ).toEqual({
        securitySchemes: [{ type: "oauth2", scopes: ["mail.modify"] }]
      });
      expect(result.tools.find((tool) => tool.name === "record_mail_action_candidates"))
        .toMatchObject({
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true
          },
          _meta: { securitySchemes: [{ type: "oauth2", scopes: ["mail.modify"] }] },
          inputSchema: {
            properties: {
              operations: {
                items: {
                  required: ["id", "mailbox", "uid"],
                  properties: {
                    mailbox: { type: "string" },
                    uid: { type: "integer" }
                  }
                }
              }
            }
          }
        });
      expect(JSON.stringify(
        result.tools.find((tool) => tool.name === "record_mail_action_candidates")
      )).not.toMatch(
        /messageId|uidValidity|summary|reason|dueAt|deferredUntil|priority|tags|subject/
      );
    });
  });

  it("검색 도구 입력을 email reader에 전달함", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "search_emails",
        arguments: {
          mailbox: "INBOX",
          subject: "테스트",
          flagged: true,
          minSize: 1_024,
          maxSize: 2_048,
          olderThanUid: 100,
          limit: 10
        }
      });

      expect(emailReader.searchEmails).toHaveBeenCalledWith({
        mailbox: "INBOX",
        subject: "테스트",
        flagged: true,
        minSize: 1_024,
        maxSize: 2_048,
        olderThanUid: 100,
        limit: 10
      });
      expect(result.structuredContent).toMatchObject({
        result: [{ uid: 42, subject: "테스트 메일" }]
      });
      expect((result.structuredContent as { result: Array<Record<string, unknown>> }).result[0])
        .not.toHaveProperty("text");
      expect((result.structuredContent as { result: Array<Record<string, unknown>> }).result[0])
        .not.toHaveProperty("attachments");
    });
  });

  it("편지함 상태 조회를 email reader에 전달함", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "get_mailbox_status",
        arguments: { mailbox: "INBOX" }
      });

      expect(emailReader.getMailboxStatus).toHaveBeenCalledWith("INBOX");
      expect(result.structuredContent).toMatchObject({
        result: {
          mailbox: "INBOX",
          uidValidity: "123",
          uidValidityUsable: true,
          uidNext: 43,
          exists: 10,
          highestModseq: "999"
        }
      });
    });
  });

  it("메일 후속 조치 ledger를 생성, 검색, 갱신함", async () => {
    await withClient(async (client) => {
      const created = await client.callTool({
        name: "upsert_mail_actions",
        arguments: {
          operations: [{
            id: "create-ledger-action",
            mailbox: "INBOX",
            sourceMailbox: "GPT 검토/MMCP 개선",
            legacyMailbox: "GPT 검토/MMCP 개선",
            uid: 42,
            uidValidity: "123",
            uidValidityUsable: true,
            messageId: "<message@example.com>",
            subject: "납부 요청",
            from: ["billing@example.com"],
            date: "2026-06-07T00:00:00.000Z",
            size: 1024,
            status: "actionable",
            actionType: "pay",
            summary: "요금 납부",
            reason: "기한 전 처리 필요",
            dueAt: "2026-06-30T00:00:00.000Z",
            tags: ["topic:billing"],
            todoistSyncStatus: "export_ready"
          }]
        }
      });
      const createResult = created.structuredContent as {
        result: {
          results: Array<{
            status: "succeeded";
            result: { action: { id: string; revision: number } };
          }>;
        };
      };
      const action = createResult.result.results[0]!.result.action;

      expect(created.structuredContent).toMatchObject({
        result: {
          attempted: 1,
          succeeded: 1,
          failed: 0,
          results: [{
            id: "create-ledger-action",
            status: "succeeded",
            result: {
              action: {
                status: "actionable",
                actionType: "pay",
                mailbox: "INBOX",
                sourceMailbox: "GPT 검토/MMCP 개선",
                legacyMailbox: "GPT 검토/MMCP 개선",
                uid: 42,
                uidValidity: "123",
                uidValidityUsable: true,
                tags: ["topic:billing"],
                todoistSyncStatus: "export_ready"
              }
            }
          }]
        }
      });

      const search = await client.callTool({
        name: "search_mail_actions",
        arguments: {
          statuses: ["actionable"],
          actionTypes: ["pay"],
          tags: ["topic:billing"],
          limit: 10
        }
      });
      expect(search.structuredContent).toMatchObject({
        result: [{
          id: action.id,
          displaySubject: "납부 요청",
          displayFrom: "billing@example.com"
        }]
      });

      const candidates = await client.callTool({
        name: "get_todoist_export_candidates",
        arguments: { limit: 10 }
      });
      expect(candidates.structuredContent).toMatchObject({
        result: [{
          actionId: action.id,
          taskTitle: "요금 납부",
          priority: "normal",
          tags: ["topic:billing"]
        }]
      });

      const updated = await client.callTool({
        name: "update_mail_actions",
        arguments: {
          operations: [{
            id: "finish-ledger-action",
            actionId: action.id,
            expectedRevision: action.revision,
            status: "done",
            cleanupStatus: "candidate"
          }]
        }
      });
      expect(updated.structuredContent).toMatchObject({
        result: {
          attempted: 1,
          succeeded: 1,
          failed: 0,
          results: [{
            status: "succeeded",
            result: { action: { status: "done", cleanupStatus: "candidate" } }
          }]
        }
      });
    });
  });

  it("후속 조치 후보 기록 도구는 최소 입력으로 기본 candidate를 기록하고 메일 reader를 호출하지 않음", async () => {
    await withClient(async (client) => {
      const before = emailReaderCallCounts();
      const created = await client.callTool({
        name: "record_mail_action_candidates",
        arguments: {
          operations: [{
            id: "record-candidate-minimal",
            mailbox: "INBOX",
            uid: 61546
          }]
        }
      });

      expect(created.structuredContent).toMatchObject({
        result: {
          attempted: 1,
          succeeded: 1,
          failed: 0,
          results: [{
            id: "record-candidate-minimal",
            status: "succeeded",
            result: {
              action: {
                status: "candidate",
                actionType: "review",
                cleanupStatus: "none",
                mailbox: "INBOX",
                uid: 61546,
                uidValidity: null,
                uidValidityUsable: false,
                priority: "normal",
                tags: [],
                todoistSyncStatus: "not_needed"
              }
            }
          }]
        }
      });

      expect(emailReaderCallCounts()).toEqual(before);

      const action = (created.structuredContent as {
        result: {
          results: Array<{
            result: { action: { id: string; revision: number } };
          }>;
        };
      }).result.results[0]!.result.action;
      const updated = await client.callTool({
        name: "update_mail_actions",
        arguments: {
          operations: [{
            id: "update-candidate-metadata",
            actionId: action.id,
            expectedRevision: action.revision,
            summary: "후속 조치 후보 설명",
            reason: "별도 metadata 갱신 검증",
            tags: ["test:candidate-metadata"]
          }]
        }
      });
      expect(updated.structuredContent).toMatchObject({
        result: {
          succeeded: 1,
          results: [{
            result: {
              action: {
                id: action.id,
                summary: "후속 조치 후보 설명",
                reason: "별도 metadata 갱신 검증",
                tags: ["test:candidate-metadata"]
              }
            }
          }]
        }
      });
    });
  });

  it("기존 upsert에서 상태 필드를 생략하면 기존 status와 actionType을 보존함", async () => {
    await withClient(async (client) => {
      const created = await client.callTool({
        name: "upsert_mail_actions",
        arguments: {
          operations: [{
            id: "create-actionable-upsert",
            mailbox: "INBOX",
            uid: 100,
            uidValidity: "123",
            uidValidityUsable: true,
            status: "actionable",
            actionType: "pay",
            cleanupStatus: "candidate",
            priority: "high",
            todoistSyncStatus: "export_ready",
            tags: ["topic:billing"]
          }]
        }
      });
      const action = (created.structuredContent as {
        result: {
          results: Array<{
            result: { action: { id: string } };
          }>;
        };
      }).result.results[0]!.result.action;

      const upserted = await client.callTool({
        name: "upsert_mail_actions",
        arguments: {
          operations: [{
            id: "upsert-without-default-fields",
            mailbox: "INBOX",
            uid: 100,
            uidValidity: "123",
            uidValidityUsable: true,
            summary: "요약만 갱신"
          }]
        }
      });

      expect(upserted.structuredContent).toMatchObject({
        result: {
          attempted: 1,
          succeeded: 1,
          failed: 0,
          results: [{
            status: "succeeded",
            result: {
              action: {
                id: action.id,
                status: "actionable",
                actionType: "pay",
                cleanupStatus: "candidate",
                priority: "high",
                todoistSyncStatus: "export_ready",
                tags: ["topic:billing"],
                summary: "요약만 갱신"
              }
            }
          }]
        }
      });
    });
  });

  it("메일 후속 조치 ledger의 stale revision 실패를 개별 작업 실패로 반환함", async () => {
    await withClient(async (client) => {
      const created = await client.callTool({
        name: "upsert_mail_actions",
        arguments: {
          operations: [{
            id: "create-stale-action",
            mailbox: "INBOX",
            uid: 43,
            status: "actionable",
            actionType: "review"
          }]
        }
      });
      const action = (created.structuredContent as {
        result: {
          results: Array<{
            result: { action: { id: string; revision: number } };
          }>;
        };
      }).result.results[0]!.result.action;

      await client.callTool({
        name: "update_mail_actions",
        arguments: {
          operations: [{
            id: "advance-action",
            actionId: action.id,
            expectedRevision: action.revision,
            status: "waiting"
          }]
        }
      });
      const stale = await client.callTool({
        name: "update_mail_actions",
        arguments: {
          operations: [{
            id: "stale-action",
            actionId: action.id,
            expectedRevision: action.revision,
            status: "done"
          }]
        }
      });

      expect(stale.structuredContent).toMatchObject({
        result: {
          attempted: 1,
          succeeded: 0,
          failed: 1,
          results: [{
            id: "stale-action",
            status: "failed",
            code: "STALE_MAIL_ACTION_REVISION"
          }]
        }
      });
    });
  });

  it("검색 도구의 잘못된 UID cursor와 크기 범위를 실행 전에 거부함", async () => {
    await withClient(async (client) => {
      const before = vi.mocked(emailReader.searchEmails).mock.calls.length;
      const invalidCursor = await client.callTool({
        name: "search_emails",
        arguments: { mailbox: "INBOX", olderThanUid: 0 }
      });
      const invalidSizeRange = await client.callTool({
        name: "search_emails",
        arguments: { mailbox: "INBOX", minSize: 2_048, maxSize: 1_024 }
      });
      const tooLargeSize = await client.callTool({
        name: "search_emails",
        arguments: { mailbox: "INBOX", maxSize: 4_294_967_295 }
      });
      const negativeSize = await client.callTool({
        name: "search_emails",
        arguments: { mailbox: "INBOX", minSize: -1 }
      });

      expect(invalidCursor.isError).toBe(true);
      expect(invalidSizeRange.isError).toBe(true);
      expect(tooLargeSize.isError).toBe(true);
      expect(negativeSize.isError).toBe(true);
      expect(vi.mocked(emailReader.searchEmails).mock.calls).toHaveLength(before);
    });
  });

  it("여러 이메일을 조회하고 개별 실패 후 다음 작업을 계속함", async () => {
    await withClient(async (client) => {
      vi.mocked(emailReader.getEmail)
        .mockRejectedValueOnce(new Error("요청한 이메일을 찾을 수 없음"))
        .mockRejectedValueOnce(new Error("이메일 크기가 조회 제한(5242880 bytes)을 초과함"))
        .mockResolvedValueOnce({
          mailbox: "Other",
          uid: 7,
          messageId: "<other@example.com>",
          subject: "다른 편지함 메일",
          from: ["sender@example.com"],
          to: ["user@naver.com"],
          cc: [],
          replyTo: [],
          date: "2026-06-07T00:00:00.000Z",
          size: 2048,
          flags: [],
          hasAttachments: false,
          text: "다른 본문",
          attachments: []
        });

      const result = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: [
            { id: "missing", mailbox: "INBOX", uid: 42 },
            { id: "too-large", mailbox: "INBOX", uid: 43 },
            { id: "other", mailbox: "Other", uid: 7 }
          ]
        }
      });

      expect(emailReader.getEmail).toHaveBeenCalledWith("INBOX", 42);
      expect(emailReader.getEmail).toHaveBeenCalledWith("INBOX", 43);
      expect(emailReader.getEmail).toHaveBeenCalledWith("Other", 7);
      expect(result.structuredContent).toEqual({
        result: {
          attempted: 3,
          succeeded: 1,
          failed: 2,
          results: [
            {
              id: "missing",
              status: "failed",
              code: "MESSAGE_NOT_FOUND",
              error: "요청한 이메일을 찾을 수 없음"
            },
            {
              id: "too-large",
              status: "failed",
              code: "EMAIL_TOO_LARGE",
              error: "이메일 크기가 조회 제한을 초과함"
            },
            {
              id: "other",
              status: "succeeded",
              email: expect.objectContaining({
                mailbox: "Other",
                uid: 7,
                subject: "다른 편지함 메일",
                text: "다른 본문",
                textLength: 5,
                textTruncated: false
              })
            }
          ]
        }
      });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content).toHaveLength(1);
      expect(content[0]?.text).not.toContain("\n");
      expect(JSON.parse(content[0]?.text ?? "")).toEqual(result.structuredContent);
    });
  });

  it("단건 이메일 조회는 기존 전체 본문 계약을 유지함", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "get_email",
        arguments: { mailbox: "INBOX", uid: 42 }
      });
      const email = (result.structuredContent as { result: Record<string, unknown> }).result;

      expect(email).toMatchObject({ mailbox: "INBOX", uid: 42, text: "본문" });
      expect(email).not.toHaveProperty("textLength");
      expect(email).not.toHaveProperty("textTruncated");
      expect(email).not.toHaveProperty("truncationReason");
    });
  });

  it("여러 이메일 조회는 기본 길이로 본문을 제한하고 잘림 정보를 반환함", async () => {
    await withClient(async (client) => {
      vi.mocked(emailReader.getEmail)
        .mockResolvedValueOnce(emailDetail("INBOX", 1, "가".repeat(2_500), [{
          filename: "invoice.pdf",
          contentType: "application/pdf",
          size: 100,
          disposition: "attachment"
        }]))
        .mockResolvedValueOnce(emailDetail("Other", 2, "짧은 본문"));

      const result = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: [
            { id: "long", mailbox: "INBOX", uid: 1 },
            { id: "short", mailbox: "Other", uid: 2 }
          ]
        }
      });

      expect(result.structuredContent).toMatchObject({
        result: {
          attempted: 2,
          succeeded: 2,
          failed: 0,
          results: [
            {
              id: "long",
              status: "succeeded",
              email: {
                text: "가".repeat(2_000),
                textLength: 2_500,
                textTruncated: true,
                truncationReason: "per-email-limit",
                attachments: [expect.objectContaining({ filename: "invoice.pdf" })]
              }
            },
            {
              id: "short",
              status: "succeeded",
              email: {
                text: "짧은 본문",
                textLength: 5,
                textTruncated: false,
                attachments: []
              }
            }
          ]
        }
      });
    });
  });

  it("여러 이메일 조회는 본문과 첨부 메타데이터 제외 옵션을 적용함", async () => {
    await withClient(async (client) => {
      vi.mocked(emailReader.getEmail).mockResolvedValueOnce(
        emailDetail("INBOX", 1, "본문", [{
          filename: "invoice.pdf",
          contentType: "application/pdf",
          size: 100,
          disposition: "attachment"
        }])
      );

      const result = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: [{ id: "metadata-only", mailbox: "INBOX", uid: 1 }],
          includeText: false,
          includeAttachmentMetadata: false
        }
      });
      const email = (result.structuredContent as {
        result: { results: Array<{ email: Record<string, unknown> }> };
      }).result.results[0]?.email;

      expect(email).toMatchObject({
        textLength: 2,
        textTruncated: true,
        attachments: []
      });
      expect(email).not.toHaveProperty("text");
      expect(email).not.toHaveProperty("truncationReason");
    });
  });

  it("여러 이메일 조회는 명시적 본문 제한과 호출 전체 제한을 적용함", async () => {
    await withClient(async (client) => {
      vi.mocked(emailReader.getEmail)
        .mockResolvedValueOnce(emailDetail("INBOX", 1, "😀".repeat(15_000)))
        .mockResolvedValueOnce(emailDetail("Other", 2, "나".repeat(15_000)));

      const result = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: [
            { id: "first", mailbox: "INBOX", uid: 1 },
            { id: "second", mailbox: "Other", uid: 2 }
          ],
          textMaxChars: 20_000
        }
      });
      const results = (result.structuredContent as {
        result: { results: Array<{ email: { text: string; truncationReason: string } }> };
      }).result.results;

      expect([...results[0]!.email.text]).toHaveLength(10_000);
      expect([...results[1]!.email.text]).toHaveLength(10_000);
      expect(results[0]!.email.truncationReason).toBe("total-text-limit");
      expect(results[1]!.email.truncationReason).toBe("total-text-limit");
      expect(results.reduce((sum, item) => sum + [...item.email.text].length, 0)).toBe(20_000);
    });
  });

  it("여러 이메일 조회는 명시한 작은 본문 제한을 적용함", async () => {
    await withClient(async (client) => {
      vi.mocked(emailReader.getEmail).mockResolvedValueOnce(
        emailDetail("INBOX", 1, "😀가나다")
      );

      const result = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: [{ id: "custom-limit", mailbox: "INBOX", uid: 1 }],
          textMaxChars: 3
        }
      });

      expect(result.structuredContent).toMatchObject({
        result: {
          results: [{
            id: "custom-limit",
            status: "succeeded",
            email: {
              text: "😀가나",
              textLength: 4,
              textTruncated: true,
              truncationReason: "per-email-limit"
            }
          }]
        }
      });
    });
  });

  it("여러 이메일 조회의 중복과 최대 개수 초과를 실행 전에 거부함", async () => {
    await withClient(async (client) => {
      const before = vi.mocked(emailReader.getEmail).mock.calls.length;
      const duplicate = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: [
            { id: "first", mailbox: "INBOX", uid: 42 },
            { id: "second", mailbox: "INBOX", uid: 42 }
          ]
        }
      });
      const tooMany = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: Array.from({ length: 21 }, (_, index) => ({
            id: `email-${index}`,
            mailbox: "INBOX",
            uid: index + 1
          }))
        }
      });
      const invalidTextLimit = await client.callTool({
        name: "get_emails",
        arguments: {
          operations: [{ id: "invalid-limit", mailbox: "INBOX", uid: 1 }],
          textMaxChars: 0
        }
      });

      expect(duplicate.isError).toBe(true);
      expect(tooMany.isError).toBe(true);
      expect(invalidTextLimit.isError).toBe(true);
      expect(vi.mocked(emailReader.getEmail).mock.calls).toHaveLength(before);
    });
  });

  it("여러 읽음 상태 변경을 한 호출에서 처리하고 작업별 성공을 반환함", async () => {
    await withClient(async (client) => {
      const bulkId = randomUUID();
      const result = await client.callTool({
        name: "set_emails_read_status",
        arguments: {
          bulkId,
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
          bulkId,
          tool: "set_emails_read_status",
          status: "succeeded",
          attempted: 2,
          succeeded: 2,
          failed: 0,
          pending: 0,
          running: 0,
          uncertain: 0,
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
      const bulkId = randomUUID();
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
          bulkId,
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
          bulkId,
          tool: "move_emails",
          status: "failed",
          attempted: 2,
          succeeded: 1,
          failed: 1,
          pending: 0,
          running: 0,
          uncertain: 0,
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
      const bulkId = randomUUID();
      const operations = Array.from({ length: 5 }, (_, index) => ({
        id: `move-${index + 1}`,
        mailbox: "INBOX",
        uid: index + 1,
        destinationMailbox: "Target"
      }));
      const result = await client.callTool({
        name: "move_emails",
        arguments: { bulkId, operations }
      });

      expect(result.structuredContent).toEqual({
        result: {
          bulkId,
          tool: "move_emails",
          status: "succeeded",
          attempted: 5,
          succeeded: 5,
          failed: 0,
          pending: 0,
          running: 0,
          uncertain: 0,
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
          bulkId: randomUUID(),
          operations: [
            { id: "trash-inbox", mailbox: "INBOX", uid: 42 },
            { id: "trash-other", mailbox: "Other", uid: 7 }
          ]
        }
      });
      await client.callTool({
        name: "mark_emails_as_spam",
        arguments: {
          bulkId: randomUUID(),
          operations: [{ id: "spam-inbox", mailbox: "INBOX", uid: 43 }]
        }
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
          bulkId: randomUUID(),
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
          bulkId: randomUUID(),
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

  it("동일 bulkId 재호출은 작업을 다시 실행하지 않고 영속 상태를 반환함", async () => {
    await withClient(async (client) => {
      const bulkId = randomUUID();
      const before = vi.mocked(emailReader.copyEmail).mock.calls.length;
      const arguments_ = {
        bulkId,
        operations: [{
          id: "copy-once",
          mailbox: "INBOX",
          uid: 42,
          destinationMailbox: "Target"
        }]
      };

      await client.callTool({ name: "copy_emails", arguments: arguments_ });
      const retried = await client.callTool({ name: "copy_emails", arguments: arguments_ });
      const status = await client.callTool({
        name: "get_bulk_operation_status",
        arguments: { bulkId }
      });

      expect(vi.mocked(emailReader.copyEmail).mock.calls).toHaveLength(before + 1);
      expect(retried.structuredContent).toMatchObject({
        result: { bulkId, status: "succeeded", succeeded: 1 }
      });
      expect(status.structuredContent).toEqual(retried.structuredContent);
      expect(JSON.stringify(status.structuredContent)).not.toContain("INBOX");
      expect(JSON.stringify(status.structuredContent)).not.toContain("Target");
      expect(JSON.stringify(status.structuredContent)).not.toContain("\"uid\"");
    });
  });

  it("재개 도구는 pending 작업만 실행하고 uncertain 작업은 재시도하지 않음", async () => {
    await withClient(async (client, { bulkJournalStore }) => {
      const bulkId = randomUUID();
      bulkJournalStore.beginBulk(bulkId, "copy_emails", [
        {
          id: "uncertain-copy",
          mailbox: "INBOX",
          uid: 42,
          destinationMailbox: "Target"
        },
        {
          id: "pending-copy",
          mailbox: "Other",
          uid: 7,
          destinationMailbox: "Target"
        }
      ]);
      bulkJournalStore.claimPending(bulkId, "uncertain-copy");
      bulkJournalStore.recoverRunning();
      const before = vi.mocked(emailReader.copyEmail).mock.calls.length;

      const resumed = await client.callTool({
        name: "resume_bulk_operation",
        arguments: { bulkId }
      });

      expect(vi.mocked(emailReader.copyEmail).mock.calls).toHaveLength(before + 1);
      expect(emailReader.copyEmail).toHaveBeenLastCalledWith("Other", 7, "Target");
      expect(resumed.structuredContent).toMatchObject({
        result: {
          bulkId,
          status: "uncertain",
          succeeded: 1,
          uncertain: 1,
          results: [
            { id: "uncertain-copy", status: "uncertain" },
            { id: "pending-copy", status: "succeeded" }
          ]
        }
      });
    });
  });

  it("재개 도구는 uncertain 읽음 작업을 현재 상태로 확정하거나 안전하게 재실행함", async () => {
    await withClient(async (client, { bulkJournalStore }) => {
      const bulkId = randomUUID();
      bulkJournalStore.beginBulk(bulkId, "set_emails_read_status", [
        { id: "already-read", mailbox: "INBOX", uid: 42, read: true },
        { id: "needs-retry", mailbox: "Other", uid: 7, read: true }
      ]);
      bulkJournalStore.claimPending(bulkId, "already-read");
      bulkJournalStore.claimPending(bulkId, "needs-retry");
      bulkJournalStore.recoverRunning();
      vi.mocked(emailReader.getEmailState)
        .mockResolvedValueOnce({ mailbox: "INBOX", uid: 42, read: true, flagged: false })
        .mockResolvedValueOnce({ mailbox: "Other", uid: 7, read: false, flagged: false });
      const beforeState = vi.mocked(emailReader.getEmailState).mock.calls.length;
      const before = vi.mocked(emailReader.setEmailReadStatus).mock.calls.length;

      const resumed = await client.callTool({
        name: "resume_bulk_operation",
        arguments: { bulkId }
      });

      expect(vi.mocked(emailReader.getEmailState).mock.calls).toHaveLength(beforeState + 2);
      expect(vi.mocked(emailReader.setEmailReadStatus).mock.calls).toHaveLength(before + 1);
      expect(emailReader.setEmailReadStatus).toHaveBeenLastCalledWith("Other", 7, true);
      expect(resumed.structuredContent).toMatchObject({
        result: {
          bulkId,
          status: "succeeded",
          succeeded: 2,
          uncertain: 0
        }
      });
    });
  });

  it("uncertain 읽음 작업의 현재 상태를 조회할 수 없으면 uncertain으로 유지함", async () => {
    await withClient(async (client, { bulkJournalStore }) => {
      const bulkId = randomUUID();
      bulkJournalStore.beginBulk(bulkId, "set_emails_read_status", [
        { id: "unknown-read", mailbox: "INBOX", uid: 42, read: true }
      ]);
      bulkJournalStore.claimPending(bulkId, "unknown-read");
      bulkJournalStore.recoverRunning();
      vi.mocked(emailReader.getEmailState).mockRejectedValueOnce(new Error("IMAP 연결 실패"));
      const before = vi.mocked(emailReader.setEmailReadStatus).mock.calls.length;

      const resumed = await client.callTool({
        name: "resume_bulk_operation",
        arguments: { bulkId }
      });

      expect(vi.mocked(emailReader.setEmailReadStatus).mock.calls).toHaveLength(before);
      expect(resumed.structuredContent).toMatchObject({
        result: {
          bulkId,
          status: "uncertain",
          failed: 0,
          uncertain: 1,
          results: [{ id: "unknown-read", status: "uncertain" }]
        }
      });
    });
  });

  it("최근 벌크 작업 진단에는 개인정보 없이 실행 요약만 반환함", async () => {
    await withClient(async (client) => {
      await client.callTool({
        name: "move_emails",
        arguments: {
          bulkId: randomUUID(),
          operations: [{
            id: "diagnostic-operation",
            mailbox: "INBOX",
            uid: 42,
            destinationMailbox: "Target"
          }]
        }
      });
      await client.callTool({
        name: "record_mail_action_candidates",
        arguments: {
          operations: [{
            id: "diagnostic-ledger-operation",
            mailbox: "INBOX",
            uid: 61546
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
      expect(entries).toContainEqual(expect.objectContaining({
        tool: "record_mail_action_candidates",
        phase: "completed",
        attempted: 1,
        succeeded: 1,
        failed: 0
      }));
      expect(JSON.stringify(diagnostics.structuredContent)).not.toContain("INBOX");
      expect(JSON.stringify(diagnostics.structuredContent)).not.toContain("diagnostic-operation");
      expect(JSON.stringify(diagnostics.structuredContent)).not.toContain("diagnostic-ledger-operation");
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

  it("메일 관리 규칙을 조회하고 patch를 미리 본 뒤 적용하고 복원함", async () => {
    await withClient(async (client) => {
      expect(client.getInstructions()).toContain("현재 메일 관리 규칙 revision 1");
      expect(client.getInstructions()).toContain("ask-when-uncertain");
      expect(client.getInstructions()).not.toContain("policy");
      expect(client.getInstructions()).not.toContain("정책");

      const current = await client.callTool({
        name: "get_mail_rules",
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
        name: "preview_mail_rules_patch",
        arguments: patch
      });
      expect(preview.structuredContent).toMatchObject({
        result: {
          currentRevision: 1,
          nextRevision: 2,
          ruleSet: { revision: 2 }
        }
      });
      expect(JSON.stringify(preview.structuredContent)).not.toContain('"policy"');

      const applied = await client.callTool({
        name: "apply_mail_rules_patch",
        arguments: patch
      });
      expect(applied.structuredContent).toMatchObject({
        result: {
          currentRevision: 1,
          nextRevision: 2,
          ruleSet: { revision: 2 }
        }
      });
      expect(
        (await client.callTool({
          name: "get_mail_rules_history",
          arguments: { limit: 10 }
        })).structuredContent
      ).toMatchObject({
        result: [{ revision: 2 }, { revision: 1 }]
      });

      const reverted = await client.callTool({
        name: "revert_mail_rules_revision",
        arguments: { expectedRevision: 2, targetRevision: 1 }
      });
      expect(reverted.structuredContent).toMatchObject({
        result: {
          currentRevision: 2,
          nextRevision: 3,
          ruleSet: { revision: 3 }
        }
      });
    });
  });
});

async function withClient(
  operation: (
    client: Client,
    context: { bulkJournalStore: SqliteBulkJournalStore }
  ) => Promise<void>
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mmcp-mcp-policy-test-"));
  const workflowPath = join(directory, "workflow.sqlite");
  const ledgerStore = new SqliteLedgerStore(workflowPath);
  const bulkJournalStore = new SqliteBulkJournalStore(workflowPath);
  const server = createMcpServer(emailReader, {
    policyStore: new PolicyStore(join(directory, "policy.json")),
    ledgerStore,
    bulkJournalStore
  });
  const client = new Client({ name: "mmcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await operation(client, { bulkJournalStore });
  } finally {
    await client.close();
    await server.close();
    ledgerStore.close();
    bulkJournalStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function emailDetail(
  mailbox: string,
  uid: number,
  text: string,
  attachments: Array<{
    filename: string | null;
    contentType: string;
    size: number;
    disposition: string | null;
  }> = []
) {
  return {
    mailbox,
    uid,
    messageId: `<${uid}@example.com>`,
    subject: "테스트 메일",
    from: ["sender@example.com"],
    to: ["user@naver.com"],
    cc: [],
    replyTo: [],
    date: "2026-06-07T00:00:00.000Z",
    size: 2048,
    flags: [],
    hasAttachments: attachments.length > 0,
    text,
    attachments
  };
}
