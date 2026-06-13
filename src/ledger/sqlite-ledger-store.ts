import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  type CleanupConfig,
  defaultCleanupConfig,
  type LedgerStore,
  type MailAction,
  type MailActionDetail,
  type MailActionEvent,
  type MailActionMutationResult,
  type MailActionStatus,
  type MailActionType,
  type MailCleanupStatus,
  type RecordMailActionLocationInput,
  type SearchMailActionsInput,
  type TodoistExportCandidate,
  type TodoistSyncResultInput,
  type TodoistSyncStatus,
  type UpdateMailActionInput,
  type UpsertMailActionInput
} from "./types.js";

type ActionRow = {
  id: string;
  status: MailActionStatus;
  action_type: MailActionType;
  cleanup_status: MailCleanupStatus;
  cleanup_config_json: string;
  mailbox: string;
  source_mailbox: string | null;
  legacy_mailbox: string | null;
  uid: number | null;
  uid_validity: string | null;
  uid_validity_usable: 0 | 1;
  message_id: string | null;
  mail_fingerprint: string;
  subject_hash: string | null;
  from_hash: string | null;
  display_subject: string | null;
  display_from: string | null;
  display_date: string | null;
  display_size: number | null;
  summary: string | null;
  reason: string | null;
  due_at: string | null;
  deferred_until: string | null;
  priority: "low" | "normal" | "high";
  tags_json: string;
  todoist_task_id: string | null;
  todoist_sync_status: TodoistSyncStatus;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  completed_at: string | null;
  revision: number;
};

type EventRow = {
  id: string;
  action_id: string;
  event_type: string;
  before_status: MailActionStatus | null;
  after_status: MailActionStatus | null;
  created_at: string;
  metadata_json: string;
};

const schemaVersion = 2;
const allowedTransitions: Record<MailActionStatus, MailActionStatus[]> = {
  candidate: ["actionable", "not_actionable", "dismissed", "deferred", "failed"],
  actionable: ["waiting", "deferred", "done", "dismissed", "failed"],
  deferred: ["actionable", "dismissed", "failed"],
  waiting: ["actionable", "done", "failed"],
  done: ["actionable"],
  dismissed: ["actionable"],
  not_actionable: ["candidate"],
  failed: ["actionable", "dismissed"]
};

const terminalStatuses = new Set<MailActionStatus>([
  "done",
  "dismissed",
  "not_actionable"
]);

export class SqliteLedgerStore implements LedgerStore {
  private readonly database: DatabaseSync;
  private readonly hmacSalt: string;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.hmacSalt = this.getOrCreateSalt();
  }

  close(): void {
    this.database.close();
  }

  searchMailActions(input: SearchMailActionsInput): MailAction[] {
    const rows = this.database.prepare(`
      SELECT * FROM mail_actions
      WHERE (? IS NULL OR mailbox = ?)
        AND (? IS NULL OR todoist_sync_status = ?)
        AND (? IS NULL OR due_at <= ?)
        AND (? IS NULL OR deferred_until <= ?)
      ORDER BY updated_at DESC, id DESC
      LIMIT 500
    `).all(
      input.mailbox ?? null,
      input.mailbox ?? null,
      input.todoistSyncStatus ?? null,
      input.todoistSyncStatus ?? null,
      input.dueBefore ?? null,
      input.dueBefore ?? null,
      input.deferredBefore ?? null,
      input.deferredBefore ?? null
    ) as ActionRow[];

    return rows
      .map(mapAction)
      .filter((action) => !input.statuses || input.statuses.includes(action.status))
      .filter((action) => !input.actionTypes || input.actionTypes.includes(action.actionType))
      .filter((action) =>
        !input.tags || input.tags.every((tag) => action.tags.includes(tag))
      )
      .slice(0, input.limit);
  }

  getMailAction(actionId: string): MailActionDetail {
    const row = this.getActionRow(actionId);
    const events = this.database.prepare(`
      SELECT * FROM mail_action_events
      WHERE action_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(actionId) as EventRow[];
    return {
      ...mapAction(row),
      events: events.map(mapEvent)
    };
  }

  upsertMailAction(input: UpsertMailActionInput): MailActionMutationResult {
    const normalized = normalizeUpsertInput(input, this);
    const existing = this.findExistingAction(normalized);
    if (existing) {
      return this.updateExistingFromUpsert(existing, normalized);
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const status = normalized.status ?? "candidate";
    const cleanupConfig = mergeCleanupConfig(null, normalized.cleanupConfig);
    this.database.prepare(`
      INSERT INTO mail_actions (
        id, status, action_type, cleanup_status, cleanup_config_json,
        mailbox, source_mailbox, legacy_mailbox, uid, uid_validity, uid_validity_usable,
        message_id, mail_fingerprint, subject_hash, from_hash,
        display_subject, display_from, display_date, display_size,
        summary, reason, due_at, deferred_until, priority, tags_json,
        todoist_task_id, todoist_sync_status,
        created_at, updated_at, last_seen_at, completed_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      status,
      normalized.actionType ?? "review",
      normalized.cleanupStatus ?? "none",
      JSON.stringify(cleanupConfig),
      normalized.mailbox,
      normalized.sourceMailbox ?? null,
      normalized.legacyMailbox ?? null,
      normalized.uid,
      normalized.uidValidity,
      normalized.uidValidityUsable ? 1 : 0,
      normalized.messageId,
      normalized.mailFingerprint,
      normalized.subjectHash,
      normalized.fromHash,
      normalized.displaySubject,
      normalized.displayFrom,
      normalized.date,
      normalized.size,
      normalized.summary ?? null,
      normalized.reason ?? null,
      normalized.dueAt ?? null,
      normalized.deferredUntil ?? null,
      normalized.priority ?? "normal",
      JSON.stringify(normalized.tags ?? []),
      null,
      normalized.todoistSyncStatus ?? "not_needed",
      now,
      now,
      now,
      terminalStatuses.has(status) ? now : null,
      1
    );
    this.recordEvent(id, "created", null, status, {});
    return { action: mapAction(this.getActionRow(id)) };
  }

  updateMailAction(input: UpdateMailActionInput): MailActionMutationResult {
    const current = this.getActionRow(input.actionId);
    assertRevision(current, input.expectedRevision);
    const nextStatus = input.status ?? current.status;
    if (nextStatus !== current.status) {
      assertTransition(current.status, nextStatus);
    }
    const now = new Date().toISOString();
    const cleanupConfig = mergeCleanupConfig(
      parseCleanupConfig(current.cleanup_config_json),
      input.cleanupConfig
    );
    const completedAt = terminalStatuses.has(nextStatus)
      ? current.completed_at ?? now
      : current.completed_at;

    this.database.prepare(`
      UPDATE mail_actions
      SET status = ?,
          action_type = ?,
          cleanup_status = ?,
          cleanup_config_json = ?,
          summary = ?,
          reason = ?,
          due_at = ?,
          deferred_until = ?,
          priority = ?,
          tags_json = ?,
          todoist_task_id = ?,
          todoist_sync_status = ?,
          updated_at = ?,
          completed_at = ?,
          revision = revision + 1
      WHERE id = ?
    `).run(
      nextStatus,
      input.actionType ?? current.action_type,
      input.cleanupStatus ?? current.cleanup_status,
      JSON.stringify(cleanupConfig),
      input.summary !== undefined ? input.summary : current.summary,
      input.reason !== undefined ? input.reason : current.reason,
      input.dueAt !== undefined ? input.dueAt : current.due_at,
      input.deferredUntil !== undefined ? input.deferredUntil : current.deferred_until,
      input.priority ?? current.priority,
      JSON.stringify(input.tags ?? parseTags(current.tags_json)),
      input.todoistTaskId !== undefined ? input.todoistTaskId : current.todoist_task_id,
      input.todoistSyncStatus ?? current.todoist_sync_status,
      now,
      completedAt,
      input.actionId
    );
    if (nextStatus !== current.status) {
      this.recordEvent(input.actionId, "status_changed", current.status, nextStatus, {});
    } else {
      this.recordEvent(input.actionId, "updated", current.status, nextStatus, {});
    }
    return { action: mapAction(this.getActionRow(input.actionId)) };
  }

  recordMailActionLocation(input: RecordMailActionLocationInput): MailActionMutationResult {
    const current = this.getActionRow(input.actionId);
    assertRevision(current, input.expectedRevision);
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE mail_actions
      SET mailbox = ?,
          uid = ?,
          uid_validity = ?,
          uid_validity_usable = ?,
          updated_at = ?,
          last_seen_at = ?,
          revision = revision + 1
      WHERE id = ?
    `).run(
      input.mailbox,
      input.uid,
      input.uidValidity ?? null,
      input.uidValidityUsable ? 1 : 0,
      now,
      now,
      input.actionId
    );
    this.recordEvent(input.actionId, "location_updated", current.status, current.status, {
      mailbox: input.mailbox,
      uidKnown: input.uid !== null,
      uidValidityUsable: Boolean(input.uidValidityUsable)
    });
    return { action: mapAction(this.getActionRow(input.actionId)) };
  }

  getTodoistExportCandidates(limit: number): TodoistExportCandidate[] {
    const rows = this.database.prepare(`
      SELECT * FROM mail_actions
      WHERE todoist_sync_status = 'export_ready'
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(limit) as ActionRow[];
    return rows.map((row) => {
      const action = mapAction(row);
      return {
        actionId: action.id,
        revision: action.revision,
        taskTitle: action.summary ?? action.displaySubject ?? "메일 후속 조치",
        taskNote: [
          action.reason,
          action.displayFrom ? `from: ${action.displayFrom}` : null,
          action.displayDate ? `date: ${action.displayDate}` : null
        ].filter(Boolean).join("\n"),
        dueAt: action.dueAt,
        priority: action.priority,
        tags: action.tags
      };
    });
  }

  recordTodoistSyncResult(input: TodoistSyncResultInput): MailActionMutationResult {
    const current = this.getActionRow(input.actionId);
    assertRevision(current, input.expectedRevision);
    const now = new Date().toISOString();
    let nextStatus = current.status;
    let nextCleanupStatus = current.cleanup_status;
    let nextSyncStatus = input.todoistSyncStatus;
    if (input.todoistSyncStatus === "completed_external") {
      if (current.status === "done" || allowedTransitions[current.status].includes("done")) {
        nextStatus = "done";
        nextCleanupStatus = "candidate";
      } else {
        nextSyncStatus = "sync_conflict";
      }
    }
    this.database.prepare(`
      UPDATE mail_actions
      SET status = ?,
          cleanup_status = ?,
          todoist_task_id = ?,
          todoist_sync_status = ?,
          updated_at = ?,
          completed_at = ?,
          revision = revision + 1
      WHERE id = ?
    `).run(
      nextStatus,
      nextCleanupStatus,
      input.todoistTaskId ?? null,
      nextSyncStatus,
      now,
      nextStatus === "done" ? current.completed_at ?? now : current.completed_at,
      input.actionId
    );
    this.recordEvent(input.actionId, "todoist_synced", current.status, nextStatus, {
      syncStatus: nextSyncStatus
    });
    return { action: mapAction(this.getActionRow(input.actionId)) };
  }

  hmac(value: string): string {
    return createHmac("sha256", this.hmacSalt).update(value).digest("hex");
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ledger_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mail_actions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        action_type TEXT NOT NULL,
        cleanup_status TEXT NOT NULL,
        cleanup_config_json TEXT NOT NULL,
        mailbox TEXT NOT NULL,
        source_mailbox TEXT,
        legacy_mailbox TEXT,
        uid INTEGER,
        uid_validity TEXT,
        uid_validity_usable INTEGER NOT NULL DEFAULT 0,
        message_id TEXT,
        mail_fingerprint TEXT NOT NULL,
        subject_hash TEXT,
        from_hash TEXT,
        display_subject TEXT,
        display_from TEXT,
        display_date TEXT,
        display_size INTEGER,
        summary TEXT,
        reason TEXT,
        due_at TEXT,
        deferred_until TEXT,
        priority TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        todoist_task_id TEXT,
        todoist_sync_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT,
        completed_at TEXT,
        revision INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mail_actions_updated_at ON mail_actions(updated_at);
      CREATE INDEX IF NOT EXISTS idx_mail_actions_status ON mail_actions(status);
      CREATE INDEX IF NOT EXISTS idx_mail_actions_todoist ON mail_actions(todoist_sync_status);
      CREATE INDEX IF NOT EXISTS idx_mail_actions_location
        ON mail_actions(mailbox, uid_validity, uid);
      CREATE INDEX IF NOT EXISTS idx_mail_actions_identity
        ON mail_actions(message_id, mail_fingerprint);

      CREATE TABLE IF NOT EXISTS mail_action_events (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL REFERENCES mail_actions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        before_status TEXT,
        after_status TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mail_action_events_action
        ON mail_action_events(action_id, created_at);

      CREATE TABLE IF NOT EXISTS mailbox_scan_state (
        mailbox TEXT PRIMARY KEY,
        uid_validity TEXT,
        uid_validity_usable INTEGER NOT NULL DEFAULT 0,
        uid_next INTEGER,
        last_scanned_uid INTEGER,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("mail_actions", "source_mailbox", "TEXT");
    this.ensureColumn("mail_actions", "legacy_mailbox", "TEXT");
    this.database.prepare(`
      INSERT INTO ledger_metadata (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(schemaVersion));
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((existing) => existing.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private getOrCreateSalt(): string {
    const existing = this.database.prepare(
      "SELECT value FROM ledger_metadata WHERE key = 'hmac_salt'"
    ).get() as { value: string } | undefined;
    if (existing) return existing.value;

    const salt = randomBytes(32).toString("hex");
    this.database.prepare("INSERT INTO ledger_metadata (key, value) VALUES ('hmac_salt', ?)")
      .run(salt);
    return salt;
  }

  private getActionRow(actionId: string): ActionRow {
    const row = this.database.prepare("SELECT * FROM mail_actions WHERE id = ?")
      .get(actionId) as ActionRow | undefined;
    if (!row) throw new Error("메일 후속 조치 항목을 찾을 수 없음");
    return row;
  }

  private findExistingAction(input: NormalizedUpsertInput): ActionRow | null {
    if (input.uid !== null && input.uidValidityUsable && input.uidValidity) {
      const byLocation = this.database.prepare(`
        SELECT * FROM mail_actions
        WHERE mailbox = ? AND uid_validity = ? AND uid = ? AND uid_validity_usable = 1
        LIMIT 1
      `).get(input.mailbox, input.uidValidity, input.uid) as ActionRow | undefined;
      if (byLocation) return byLocation;
    }

    if (input.uid !== null && !input.hasFallbackIdentity) {
      const byCurrentLocation = this.database.prepare(`
        SELECT * FROM mail_actions
        WHERE mailbox = ? AND uid = ? AND uid_validity_usable = 0 AND message_id IS NULL
        LIMIT 1
      `).get(input.mailbox, input.uid) as ActionRow | undefined;
      if (byCurrentLocation) return byCurrentLocation;
    }

    if (input.messageId) {
      const byMessageId = this.database.prepare(`
        SELECT * FROM mail_actions
        WHERE message_id = ? AND mail_fingerprint = ?
        LIMIT 1
      `).get(input.messageId, input.mailFingerprint) as ActionRow | undefined;
      if (byMessageId) return byMessageId;
    }

    if (!input.hasFallbackIdentity) {
      return null;
    }

    const byFingerprint = this.database.prepare(`
      SELECT * FROM mail_actions
      WHERE message_id IS NULL AND mail_fingerprint = ?
      LIMIT 1
    `).get(input.mailFingerprint) as ActionRow | undefined;
    return byFingerprint ?? null;
  }

  private updateExistingFromUpsert(
    current: ActionRow,
    input: NormalizedUpsertInput
  ): MailActionMutationResult {
    const nextStatus = input.status ?? current.status;
    if (nextStatus !== current.status) {
      assertTransition(current.status, nextStatus);
    }
    const now = new Date().toISOString();
    const cleanupConfig = mergeCleanupConfig(
      parseCleanupConfig(current.cleanup_config_json),
      input.cleanupConfig
    );
    this.database.prepare(`
      UPDATE mail_actions
      SET status = ?,
          action_type = ?,
          cleanup_status = ?,
          cleanup_config_json = ?,
          mailbox = ?,
          source_mailbox = ?,
          legacy_mailbox = ?,
          uid = ?,
          uid_validity = ?,
          uid_validity_usable = ?,
          display_subject = ?,
          display_from = ?,
          display_date = ?,
          display_size = ?,
          summary = ?,
          reason = ?,
          due_at = ?,
          deferred_until = ?,
          priority = ?,
          tags_json = ?,
          todoist_sync_status = ?,
          updated_at = ?,
          last_seen_at = ?,
          completed_at = ?,
          revision = revision + 1
      WHERE id = ?
    `).run(
      nextStatus,
      input.actionType ?? current.action_type,
      input.cleanupStatus ?? current.cleanup_status,
      JSON.stringify(cleanupConfig),
      input.mailbox,
      input.sourceMailbox !== undefined ? input.sourceMailbox : current.source_mailbox,
      input.legacyMailbox !== undefined ? input.legacyMailbox : current.legacy_mailbox,
      input.uid,
      input.uidValidity,
      input.uidValidityUsable ? 1 : 0,
      input.displaySubject ?? current.display_subject,
      input.displayFrom ?? current.display_from,
      input.date ?? current.display_date,
      input.size ?? current.display_size,
      input.summary ?? current.summary,
      input.reason ?? current.reason,
      input.dueAt ?? current.due_at,
      input.deferredUntil ?? current.deferred_until,
      input.priority ?? current.priority,
      JSON.stringify(mergeTags(parseTags(current.tags_json), input.tags ?? [])),
      input.todoistSyncStatus ?? current.todoist_sync_status,
      now,
      now,
      terminalStatuses.has(nextStatus) ? current.completed_at ?? now : current.completed_at,
      current.id
    );
    this.recordEvent(current.id, "upserted", current.status, nextStatus, {});
    return { action: mapAction(this.getActionRow(current.id)) };
  }

  private recordEvent(
    actionId: string,
    eventType: string,
    beforeStatus: MailActionStatus | null,
    afterStatus: MailActionStatus | null,
    metadata: Record<string, unknown>
  ): void {
    this.database.prepare(`
      INSERT INTO mail_action_events (
        id, action_id, event_type, before_status, after_status, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      actionId,
      eventType,
      beforeStatus,
      afterStatus,
      new Date().toISOString(),
      JSON.stringify(metadata)
    );
  }
}

type NormalizedUpsertInput = UpsertMailActionInput & {
  uid: number | null;
  uidValidity: string | null;
  uidValidityUsable: boolean;
  messageId: string | null;
  mailFingerprint: string;
  subjectHash: string | null;
  fromHash: string | null;
  displaySubject: string | null;
  displayFrom: string | null;
  date: string | null;
  size: number | null;
  hasFallbackIdentity: boolean;
};

function normalizeUpsertInput(
  input: UpsertMailActionInput,
  store: SqliteLedgerStore
): NormalizedUpsertInput {
  const subject = input.subject ?? input.displaySubject ?? null;
  const from = input.from?.join(", ") ?? input.displayFrom ?? null;
  const hasFallbackIdentity = Boolean(
    input.messageId || subject || from || input.date || input.size !== undefined && input.size !== null
  );
  const fingerprintInput = [
    input.messageId ?? "",
    subject ?? "",
    from ?? "",
    input.date ?? "",
    input.size ?? ""
  ].join("\0");
  return {
    ...input,
    uid: input.uid ?? null,
    uidValidity: input.uidValidity ?? null,
    uidValidityUsable: Boolean(input.uidValidityUsable && input.uidValidity),
    messageId: input.messageId ?? null,
    mailFingerprint: store.hmac(fingerprintInput),
    subjectHash: subject ? store.hmac(subject) : null,
    fromHash: from ? store.hmac(from) : null,
    displaySubject: truncateDisplay(input.displaySubject ?? subject),
    displayFrom: truncateDisplay(input.displayFrom ?? from, 320),
    date: input.date ?? null,
    size: input.size ?? null,
    tags: input.tags ?? [],
    hasFallbackIdentity
  };
}

function mapAction(row: ActionRow): MailAction {
  return {
    id: row.id,
    status: row.status,
    actionType: row.action_type,
    cleanupStatus: row.cleanup_status,
    cleanupConfig: parseCleanupConfig(row.cleanup_config_json),
    mailbox: row.mailbox,
    sourceMailbox: row.source_mailbox,
    legacyMailbox: row.legacy_mailbox,
    uid: row.uid,
    uidValidity: row.uid_validity,
    uidValidityUsable: Boolean(row.uid_validity_usable),
    messageId: row.message_id,
    mailFingerprint: row.mail_fingerprint,
    subjectHash: row.subject_hash,
    fromHash: row.from_hash,
    displaySubject: row.display_subject,
    displayFrom: row.display_from,
    displayDate: row.display_date,
    displaySize: row.display_size,
    summary: row.summary,
    reason: row.reason,
    dueAt: row.due_at,
    deferredUntil: row.deferred_until,
    priority: row.priority,
    tags: parseTags(row.tags_json),
    todoistTaskId: row.todoist_task_id,
    todoistSyncStatus: row.todoist_sync_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    completedAt: row.completed_at,
    revision: row.revision
  };
}

function mapEvent(row: EventRow): MailActionEvent {
  return {
    id: row.id,
    actionId: row.action_id,
    eventType: row.event_type,
    beforeStatus: row.before_status,
    afterStatus: row.after_status,
    createdAt: row.created_at,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
  };
}

function assertRevision(row: ActionRow, expectedRevision: number): void {
  if (row.revision !== expectedRevision) {
    throw new Error("메일 후속 조치 revision이 최신 상태와 일치하지 않음");
  }
}

function assertTransition(from: MailActionStatus, to: MailActionStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error("허용되지 않는 메일 후속 조치 상태 전이임");
  }
}

function mergeCleanupConfig(
  current: CleanupConfig | null,
  patch: Partial<CleanupConfig> | null | undefined
): CleanupConfig {
  return {
    ...(current ?? defaultCleanupConfig),
    ...(patch ?? {})
  };
}

function parseCleanupConfig(value: string): CleanupConfig {
  return { ...defaultCleanupConfig, ...(JSON.parse(value) as Partial<CleanupConfig>) };
}

function parseTags(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
}

function mergeTags(current: string[], next: string[]): string[] {
  return [...new Set([...current, ...next])].sort();
}

function truncateDisplay(value: string | null | undefined, maximum = 200): string | null {
  if (!value) return null;
  return [...value].slice(0, maximum).join("");
}
