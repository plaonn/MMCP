import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SqliteLedgerStore } from "../src/ledger/sqlite-ledger-store.js";

describe("SqliteLedgerStore", () => {
  it("DB 파일을 개인 권한으로 만들고 MailAction을 upsert/search함", () => {
    withStore(({ store, path }) => {
      const created = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 42,
        uidValidity: "123",
        uidValidityUsable: true,
        messageId: "<message@example.com>",
        subject: "납부 요청",
        from: ["billing@example.com"],
        date: "2026-06-07T00:00:00.000Z",
        size: 2048,
        status: "actionable",
        actionType: "pay",
        cleanupConfig: { terminalRetentionDays: 30 },
        displaySubject: "납부 요청",
        summary: "요금 납부",
        tags: ["topic:billing"],
        todoistSyncStatus: "export_ready"
      }).action;

      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(created).toMatchObject({
        status: "actionable",
        actionType: "pay",
        cleanupStatus: "none",
        cleanupConfig: { terminalRetentionDays: 30, dryRunDefault: true },
        mailbox: "INBOX",
        uid: 42,
        uidValidity: "123",
        uidValidityUsable: true,
        displaySubject: "납부 요청",
        summary: "요금 납부",
        tags: ["topic:billing"],
        todoistSyncStatus: "export_ready",
        revision: 1
      });
      expect(created.mailFingerprint).not.toContain("납부");
      expect(created.subjectHash).toMatch(/^[0-9a-f]{64}$/);
      expect(created.fromHash).toMatch(/^[0-9a-f]{64}$/);

      expect(store.searchMailActions({
        statuses: ["actionable"],
        actionTypes: ["pay"],
        tags: ["topic:billing"],
        limit: 10
      })).toMatchObject([{ id: created.id }]);
    });
  });

  it("동일 UIDVALIDITY/UID upsert는 기존 항목을 갱신함", () => {
    withStore(({ store }) => {
      const first = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 42,
        uidValidity: "123",
        uidValidityUsable: true,
        status: "candidate",
        tags: ["migration:gpt_review"]
      }).action;
      const second = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 42,
        uidValidity: "123",
        uidValidityUsable: true,
        status: "actionable",
        tags: ["topic:mmcp"]
      }).action;

      expect(second.id).toBe(first.id);
      expect(second.revision).toBe(2);
      expect(second.status).toBe("actionable");
      expect(second.tags).toEqual(["migration:gpt_review", "topic:mmcp"]);
    });
  });

  it("revision과 허용 상태 전이를 강제함", () => {
    withStore(({ store }) => {
      const created = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 1,
        status: "candidate"
      }).action;

      expect(() =>
        store.updateMailAction({
          actionId: created.id,
          expectedRevision: created.revision + 1,
          status: "actionable"
        })
      ).toThrow("메일 후속 조치 revision이 최신 상태와 일치하지 않음");

      expect(() =>
        store.updateMailAction({
          actionId: created.id,
          expectedRevision: created.revision,
          status: "done"
        })
      ).toThrow("허용되지 않는 메일 후속 조치 상태 전이임");

      const updated = store.updateMailAction({
        actionId: created.id,
        expectedRevision: created.revision,
        status: "actionable"
      }).action;
      expect(updated).toMatchObject({ status: "actionable", revision: 2 });
    });
  });

  it("failed는 재시도 가능한 비종결 상태로 유지함", () => {
    withStore(({ store }) => {
      const created = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 1,
        status: "actionable"
      }).action;
      const failed = store.updateMailAction({
        actionId: created.id,
        expectedRevision: created.revision,
        status: "failed"
      }).action;
      const retried = store.updateMailAction({
        actionId: failed.id,
        expectedRevision: failed.revision,
        status: "actionable"
      }).action;

      expect(failed.completedAt).toBeNull();
      expect(retried).toMatchObject({ status: "actionable", completedAt: null });
    });
  });

  it("Todoist 내보내기 후보와 sync 결과를 기록함", () => {
    withStore(({ store }) => {
      const created = store.upsertMailAction({
        mailbox: "INBOX",
        uid: null,
        messageId: "<todo@example.com>",
        status: "actionable",
        actionType: "todoist_export",
        summary: "MMCP 개선 작업",
        reason: "후속 구현 필요",
        priority: "high",
        tags: ["topic:mmcp"],
        todoistSyncStatus: "export_ready"
      }).action;

      expect(store.getTodoistExportCandidates(5)).toEqual([{
        actionId: created.id,
        revision: created.revision,
        taskTitle: "MMCP 개선 작업",
        taskNote: "후속 구현 필요",
        dueAt: null,
        priority: "high",
        tags: ["topic:mmcp"]
      }]);

      const synced = store.recordTodoistSyncResult({
        actionId: created.id,
        expectedRevision: created.revision,
        todoistTaskId: "task-1",
        todoistSyncStatus: "exported"
      }).action;
      expect(synced).toMatchObject({
        todoistTaskId: "task-1",
        todoistSyncStatus: "exported",
        revision: 2
      });
    });
  });
});

function withStore(operation: (context: { store: SqliteLedgerStore; path: string }) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "mmcp-ledger-test-"));
  const path = join(directory, "workflow.sqlite");
  const store = new SqliteLedgerStore(path);
  try {
    operation({ store, path });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
