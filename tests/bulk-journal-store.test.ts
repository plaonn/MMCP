import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { SqliteBulkJournalStore } from "../src/bulk-journal/sqlite-bulk-journal-store.js";

describe("SqliteBulkJournalStore", () => {
  it("서버 재시작 시 running을 uncertain으로 복구하고 pending을 유지함", () => {
    const directory = mkdtempSync(join(tmpdir(), "mmcp-bulk-journal-test-"));
    const path = join(directory, "workflow.sqlite");
    const first = new SqliteBulkJournalStore(path);
    first.beginBulk("11111111-1111-4111-8111-111111111111", "copy_emails", [
      { id: "running", mailbox: "INBOX", uid: 1, destinationMailbox: "Target" },
      { id: "pending", mailbox: "INBOX", uid: 2, destinationMailbox: "Target" }
    ]);
    first.claimPending("11111111-1111-4111-8111-111111111111", "running");
    first.close();

    const reopened = new SqliteBulkJournalStore(path);
    try {
      expect(reopened.getBulk("11111111-1111-4111-8111-111111111111")).toMatchObject({
        status: "uncertain",
        operations: [
          { id: "running", status: "uncertain" },
          { id: "pending", status: "pending" }
        ]
      });
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("동일 bulkId의 다른 입력을 거부함", () => {
    withStore((store) => {
      const bulkId = "22222222-2222-4222-8222-222222222222";
      store.beginBulk(bulkId, "move_emails", [
        { id: "move", mailbox: "INBOX", uid: 1, destinationMailbox: "A" }
      ]);

      expect(() => store.beginBulk(bulkId, "move_emails", [
        { id: "move", mailbox: "INBOX", uid: 1, destinationMailbox: "B" }
      ])).toThrow("bulkId가 다른 벌크 작업에 이미 사용됨");
    });
  });

  it("pending 작업은 한 실행자만 claim할 수 있음", () => {
    withStore((store) => {
      const bulkId = "33333333-3333-4333-8333-333333333333";
      store.beginBulk(bulkId, "copy_emails", [
        { id: "copy", mailbox: "INBOX", uid: 1, destinationMailbox: "Target" }
      ]);

      expect(store.claimPending(bulkId, "copy")).toBe(true);
      expect(store.claimPending(bulkId, "copy")).toBe(false);
    });
  });

  it("성공 결과 payload를 서버 재시작 후에도 보존함", () => {
    const directory = mkdtempSync(join(tmpdir(), "mmcp-bulk-journal-test-"));
    const path = join(directory, "workflow.sqlite");
    const bulkId = "55555555-5555-4555-8555-555555555555";
    const first = new SqliteBulkJournalStore(path);
    first.beginBulk(bulkId, "move_emails", [
      { id: "move", mailbox: "INBOX", uid: 1, destinationMailbox: "Target" }
    ]);
    first.claimPending(bulkId, "move");
    first.markSucceeded(bulkId, "move", {
      destinationMailbox: "Target",
      destinationUid: 84
    });
    first.close();

    const reopened = new SqliteBulkJournalStore(path);
    try {
      expect(reopened.getBulk(bulkId)).toMatchObject({
        operations: [{
          id: "move",
          status: "succeeded",
          result: {
            destinationMailbox: "Target",
            destinationUid: 84
          }
        }]
      });
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("result_json 열이 없는 기존 벌크 저널을 자동 migration함", () => {
    const directory = mkdtempSync(join(tmpdir(), "mmcp-bulk-journal-test-"));
    const path = join(directory, "workflow.sqlite");
    const database = new DatabaseSync(path);
    database.exec(`
      CREATE TABLE bulk_calls (
        bulk_id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE bulk_operations (
        bulk_id TEXT NOT NULL REFERENCES bulk_calls(bulk_id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        status TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (bulk_id, operation_id)
      );
    `);
    database.close();

    const store = new SqliteBulkJournalStore(path);
    try {
      const columns = new DatabaseSync(path);
      try {
        expect(
          (columns.prepare("PRAGMA table_info(bulk_operations)").all() as Array<{ name: string }>)
            .map(({ name }) => name)
        ).toContain("result_json");
      } finally {
        columns.close();
      }
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("마지막 갱신 후 30일이 지난 완료 벌크를 시작 시 정리함", () => {
    const directory = mkdtempSync(join(tmpdir(), "mmcp-bulk-journal-test-"));
    const path = join(directory, "workflow.sqlite");
    const bulkId = "44444444-4444-4444-8444-444444444444";
    const first = new SqliteBulkJournalStore(path);
    first.beginBulk(bulkId, "copy_emails", [
      { id: "copy", mailbox: "INBOX", uid: 1, destinationMailbox: "Target" }
    ]);
    first.claimPending(bulkId, "copy");
    first.markSucceeded(bulkId, "copy");
    first.close();

    const database = new DatabaseSync(path);
    database.prepare("UPDATE bulk_calls SET updated_at = ? WHERE bulk_id = ?").run(
      "2000-01-01T00:00:00.000Z",
      bulkId
    );
    database.close();

    const reopened = new SqliteBulkJournalStore(path);
    try {
      expect(() => reopened.getBulk(bulkId)).toThrow("벌크 작업을 찾을 수 없음");
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function withStore(operation: (store: SqliteBulkJournalStore) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "mmcp-bulk-journal-test-"));
  const store = new SqliteBulkJournalStore(join(directory, "workflow.sqlite"));
  try {
    operation(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
