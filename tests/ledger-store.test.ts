import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { SqliteLedgerStore } from "../src/ledger/sqlite-ledger-store.js";

describe("SqliteLedgerStore", () => {
  it("schema v1 DB에 migration 출처 열을 자동 추가함", () => {
    const directory = mkdtempSync(join(tmpdir(), "mmcp-ledger-migration-test-"));
    const path = join(directory, "workflow.sqlite");
    const initialStore = new SqliteLedgerStore(path);
    initialStore.close();

    const legacyDatabase = new DatabaseSync(path);
    legacyDatabase.exec(`
      ALTER TABLE mail_actions DROP COLUMN source_mailbox;
      ALTER TABLE mail_actions DROP COLUMN legacy_mailbox;
      UPDATE ledger_metadata SET value = '1' WHERE key = 'schema_version';
    `);
    legacyDatabase.close();

    const migratedStore = new SqliteLedgerStore(path);
    try {
      expect(migratedStore.upsertMailAction({
        mailbox: "INBOX",
        sourceMailbox: "GPT 검토",
        legacyMailbox: "GPT 검토",
        uid: 42
      }).action).toMatchObject({
        sourceMailbox: "GPT 검토",
        legacyMailbox: "GPT 검토"
      });
    } finally {
      migratedStore.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it("mail_fingerprint는 mailbox 변경만으로 달라지지 않음", () => {
    withStore(({ store }) => {
      const first = store.upsertMailAction({
        mailbox: "INBOX",
        uid: null,
        messageId: "<same@example.com>",
        subject: "동일 메일",
        from: ["sender@example.com"],
        date: "2026-06-07T00:00:00.000Z",
        size: 2048
      }).action;
      const moved = store.upsertMailAction({
        mailbox: "Target",
        uid: null,
        messageId: "<same@example.com>",
        subject: "동일 메일",
        from: ["sender@example.com"],
        date: "2026-06-07T00:00:00.000Z",
        size: 2048
      }).action;

      expect(moved.id).toBe(first.id);
      expect(moved.mailFingerprint).toBe(first.mailFingerprint);
      expect(moved.mailbox).toBe("Target");
      expect(moved.revision).toBe(2);
    });
  });

  it("metadata가 없는 최소 후보는 빈 fingerprint로 서로 병합하지 않음", () => {
    withStore(({ store }) => {
      const first = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 1
      }).action;
      const second = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 2
      }).action;
      const repeated = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 1,
        summary: "같은 현재 위치 재기록"
      }).action;

      expect(second.id).not.toBe(first.id);
      expect(repeated.id).toBe(first.id);
      expect(repeated.summary).toBe("같은 현재 위치 재기록");
    });
  });

  it("migration 출처는 현재 위치가 바뀐 뒤에도 보존함", () => {
    withStore(({ store }) => {
      const created = store.upsertMailAction({
        mailbox: "GPT 검토/MMCP 개선",
        sourceMailbox: "GPT 검토/MMCP 개선",
        legacyMailbox: "GPT 검토/MMCP 개선",
        uid: 42,
        uidValidity: "123",
        uidValidityUsable: true
      }).action;
      const moved = store.recordMailActionLocation({
        actionId: created.id,
        expectedRevision: created.revision,
        mailbox: "INBOX",
        uid: 100,
        uidValidity: "456",
        uidValidityUsable: true
      }).action;

      expect(moved).toMatchObject({
        mailbox: "INBOX",
        sourceMailbox: "GPT 검토/MMCP 개선",
        legacyMailbox: "GPT 검토/MMCP 개선"
      });
    });
  });

  it("중복 Message-ID라도 fingerprint가 다르면 자동 병합하지 않음", () => {
    withStore(({ store }) => {
      const first = store.upsertMailAction({
        mailbox: "GPT 검토",
        uid: 1,
        uidValidity: "0",
        uidValidityUsable: false,
        messageId: "<duplicate@example.com>",
        subject: "첫 번째"
      }).action;
      const second = store.upsertMailAction({
        mailbox: "GPT 검토",
        uid: 2,
        uidValidity: "0",
        uidValidityUsable: false,
        messageId: "<duplicate@example.com>",
        subject: "두 번째"
      }).action;

      expect(second.id).not.toBe(first.id);
    });
  });

  it("응답 누락 후 같은 identity를 다시 기록해도 event 이력으로 결과를 재조회함", () => {
    withStore(({ store }) => {
      store.upsertMailAction({
        mailbox: "INBOX",
        uid: 42,
        uidValidity: "123",
        uidValidityUsable: true
      });
      const retried = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 42,
        uidValidity: "123",
        uidValidityUsable: true
      }).action;
      const detail = store.getMailAction(retried.id);

      expect(retried.revision).toBe(2);
      expect(detail.events.map((event) => event.eventType)).toEqual(["created", "upserted"]);
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

  it("Todoist 외부 삭제와 완료를 action 손실 없이 기록함", () => {
    withStore(({ store }) => {
      const deletedCandidate = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 1,
        status: "actionable",
        todoistSyncStatus: "exported"
      }).action;
      const deleted = store.recordTodoistSyncResult({
        actionId: deletedCandidate.id,
        expectedRevision: deletedCandidate.revision,
        todoistSyncStatus: "deleted_external"
      }).action;
      expect(deleted).toMatchObject({
        id: deletedCandidate.id,
        status: "actionable",
        todoistSyncStatus: "deleted_external"
      });

      const completedCandidate = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 2,
        status: "actionable",
        cleanupStatus: "none",
        todoistSyncStatus: "exported"
      }).action;
      const completed = store.recordTodoistSyncResult({
        actionId: completedCandidate.id,
        expectedRevision: completedCandidate.revision,
        todoistSyncStatus: "completed_external"
      }).action;
      expect(completed).toMatchObject({
        id: completedCandidate.id,
        status: "done",
        cleanupStatus: "candidate",
        todoistSyncStatus: "completed_external"
      });

      const conflictingCandidate = store.upsertMailAction({
        mailbox: "INBOX",
        uid: 3,
        status: "candidate",
        todoistSyncStatus: "exported"
      }).action;
      const conflict = store.recordTodoistSyncResult({
        actionId: conflictingCandidate.id,
        expectedRevision: conflictingCandidate.revision,
        todoistSyncStatus: "completed_external"
      }).action;
      expect(conflict).toMatchObject({
        id: conflictingCandidate.id,
        status: "candidate",
        todoistSyncStatus: "sync_conflict"
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
