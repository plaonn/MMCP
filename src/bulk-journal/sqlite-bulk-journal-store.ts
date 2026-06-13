import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  BulkJournalStore,
  BulkOperationStatus,
  JournaledBulk,
  JournaledBulkOperation
} from "./types.js";

type BulkRow = {
  bulk_id: string;
  tool: string;
  status: BulkOperationStatus;
  created_at: string;
  updated_at: string;
};

type OperationRow = {
  operation_id: string;
  status: BulkOperationStatus;
  arguments_json: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
};

const retentionMilliseconds = 30 * 24 * 60 * 60 * 1000;

export class SqliteBulkJournalStore implements BulkJournalStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.recoverRunning();
    this.cleanupExpired();
  }

  close(): void {
    this.database.close();
  }

  beginBulk(
    bulkId: string,
    tool: string,
    operations: Array<{ id: string } & Record<string, unknown>>
  ): { created: boolean; bulk: JournaledBulk } {
    const existing = this.getBulkOrNull(bulkId);
    if (existing) {
      const expected = operations.map(({ id, ...arguments_ }) => ({
        id,
        arguments: arguments_
      }));
      const actual = existing.operations.map(({ id, arguments: arguments_ }) => ({
        id,
        arguments: arguments_
      }));
      if (existing.tool !== tool || JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error("bulkId가 다른 벌크 작업에 이미 사용됨");
      }
      return { created: false, bulk: existing };
    }

    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO bulk_calls (bulk_id, tool, status, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?)
      `).run(bulkId, tool, now, now);
      const insertOperation = this.database.prepare(`
        INSERT INTO bulk_operations (
          bulk_id, operation_id, ordinal, status, arguments_json,
          result_json, error_code, error_message, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?)
      `);
      operations.forEach(({ id, ...arguments_ }, ordinal) => {
        insertOperation.run(bulkId, id, ordinal, JSON.stringify(arguments_), now);
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { created: true, bulk: this.getBulk(bulkId) };
  }

  getBulk(bulkId: string): JournaledBulk {
    const bulk = this.getBulkOrNull(bulkId);
    if (!bulk) throw new Error("벌크 작업을 찾을 수 없음");
    return bulk;
  }

  claimPending(bulkId: string, operationId: string): boolean {
    return this.claimStatus(bulkId, operationId, "pending");
  }

  claimUncertain(bulkId: string, operationId: string): boolean {
    return this.claimStatus(bulkId, operationId, "uncertain");
  }

  private claimStatus(
    bulkId: string,
    operationId: string,
    currentStatus: "pending" | "uncertain"
  ): boolean {
    const now = new Date().toISOString();
    const result = this.database.prepare(`
      UPDATE bulk_operations
      SET status = 'running', result_json = NULL, error_code = NULL,
          error_message = NULL, updated_at = ?
      WHERE bulk_id = ? AND operation_id = ? AND status = ?
    `).run(now, bulkId, operationId, currentStatus);
    if (result.changes === 1) {
      this.refreshBulkStatus(bulkId, now);
      return true;
    }
    return false;
  }

  markSucceeded(
    bulkId: string,
    operationId: string,
    result?: Record<string, unknown>
  ): void {
    this.updateOperation(bulkId, operationId, "succeeded", result ?? null, null, null);
  }

  markFailed(bulkId: string, operationId: string, code: string, error: string): void {
    this.updateOperation(bulkId, operationId, "failed", null, code, error);
  }

  recoverRunning(): number {
    const now = new Date().toISOString();
    const affectedBulks = this.database.prepare(`
      SELECT DISTINCT bulk_id
      FROM bulk_operations
      WHERE status = 'running'
    `).all() as Array<{ bulk_id: string }>;
    const result = this.database.prepare(`
      UPDATE bulk_operations
      SET status = 'uncertain', result_json = NULL, updated_at = ?
      WHERE status = 'running'
    `).run(now);
    affectedBulks.forEach(({ bulk_id }) => this.refreshBulkStatus(bulk_id, now));
    return Number(result.changes);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS bulk_calls (
        bulk_id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bulk_operations (
        bulk_id TEXT NOT NULL REFERENCES bulk_calls(bulk_id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        status TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (bulk_id, operation_id)
      );

      CREATE INDEX IF NOT EXISTS idx_bulk_calls_updated_at ON bulk_calls(updated_at);
      CREATE INDEX IF NOT EXISTS idx_bulk_operations_status ON bulk_operations(status);
    `);
    this.addColumnIfMissing("bulk_operations", "result_json", "TEXT");
  }

  private getBulkOrNull(bulkId: string): JournaledBulk | null {
    const row = this.database.prepare(
      "SELECT * FROM bulk_calls WHERE bulk_id = ?"
    ).get(bulkId) as BulkRow | undefined;
    if (!row) return null;
    const operations = this.database.prepare(`
      SELECT operation_id, status, arguments_json, result_json, error_code, error_message
      FROM bulk_operations
      WHERE bulk_id = ?
      ORDER BY ordinal ASC
    `).all(bulkId) as OperationRow[];
    return {
      bulkId: row.bulk_id,
      tool: row.tool,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      operations: operations.map(mapOperation)
    };
  }

  private updateOperation(
    bulkId: string,
    operationId: string,
    status: BulkOperationStatus,
    operationResult: Record<string, unknown> | null,
    errorCode: string | null,
    error: string | null
  ): void {
    const now = new Date().toISOString();
    const updateResult = this.database.prepare(`
      UPDATE bulk_operations
      SET status = ?, result_json = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE bulk_id = ? AND operation_id = ?
    `).run(
      status,
      operationResult === null ? null : JSON.stringify(operationResult),
      errorCode,
      error,
      now,
      bulkId,
      operationId
    );
    if (updateResult.changes !== 1) throw new Error("벌크 작업 항목을 찾을 수 없음");
    this.refreshBulkStatus(bulkId, now);
  }

  private refreshBulkStatus(bulkId: string, now: string): void {
    const rows = this.database.prepare(
      "SELECT status FROM bulk_operations WHERE bulk_id = ?"
    ).all(bulkId) as Array<{ status: BulkOperationStatus }>;
    const statuses = rows.map(({ status }) => status);
    const status = aggregateStatus(statuses);
    this.database.prepare(
      "UPDATE bulk_calls SET status = ?, updated_at = ? WHERE bulk_id = ?"
    ).run(status, now, bulkId);
  }

  private cleanupExpired(): void {
    const cutoff = new Date(Date.now() - retentionMilliseconds).toISOString();
    this.database.prepare(`
      DELETE FROM bulk_calls
      WHERE updated_at < ?
        AND status IN ('succeeded', 'failed')
    `).run(cutoff);
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some(({ name }) => name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function aggregateStatus(statuses: BulkOperationStatus[]): BulkOperationStatus {
  if (statuses.includes("running")) return "running";
  if (statuses.includes("uncertain")) return "uncertain";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("failed")) return "failed";
  return "succeeded";
}

function mapOperation(row: OperationRow): JournaledBulkOperation {
  return {
    id: row.operation_id,
    status: row.status,
    arguments: JSON.parse(row.arguments_json) as Record<string, unknown>,
    result: row.result_json === null
      ? null
      : JSON.parse(row.result_json) as Record<string, unknown>,
    errorCode: row.error_code,
    error: row.error_message
  };
}
