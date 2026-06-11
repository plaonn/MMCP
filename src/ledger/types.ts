export const mailActionStatuses = [
  "candidate",
  "actionable",
  "deferred",
  "waiting",
  "done",
  "dismissed",
  "not_actionable",
  "failed"
] as const;

export type MailActionStatus = typeof mailActionStatuses[number];

export const mailActionTypes = [
  "review",
  "reply",
  "pay",
  "schedule",
  "submit",
  "download",
  "todoist_export",
  "mail_delete",
  "follow_up",
  "other"
] as const;

export type MailActionType = typeof mailActionTypes[number];

export const mailCleanupStatuses = [
  "none",
  "candidate",
  "approval_required",
  "ready",
  "completed",
  "blocked"
] as const;

export type MailCleanupStatus = typeof mailCleanupStatuses[number];

export const todoistSyncStatuses = [
  "not_needed",
  "export_ready",
  "exported",
  "sync_conflict",
  "deleted_external",
  "completed_external"
] as const;

export type TodoistSyncStatus = typeof todoistSyncStatuses[number];

export const mailActionPriorities = ["low", "normal", "high"] as const;

export type MailActionPriority = typeof mailActionPriorities[number];

export type CleanupConfig = {
  cleanupOnStartup: boolean;
  dryRunDefault: boolean;
  terminalRetentionDays: number;
  staleUnmatchedRetentionDays: number;
  mailboxSnapshotRetentionDays: number;
  todoistExportLogRetentionDays: number;
  vacuumAfterCleanup: boolean;
};

export const defaultCleanupConfig: CleanupConfig = {
  cleanupOnStartup: false,
  dryRunDefault: true,
  terminalRetentionDays: 180,
  staleUnmatchedRetentionDays: 90,
  mailboxSnapshotRetentionDays: 30,
  todoistExportLogRetentionDays: 180,
  vacuumAfterCleanup: true
};

export type MailIdentityInput = {
  mailbox: string;
  uid: number | null;
  uidValidity?: string | null;
  uidValidityUsable?: boolean;
  messageId?: string | null;
  subject?: string | null;
  from?: string[] | null;
  date?: string | null;
  size?: number | null;
};

export type UpsertMailActionInput = MailIdentityInput & {
  sourceMailbox?: string | null;
  legacyMailbox?: string | null;
  status?: MailActionStatus;
  actionType?: MailActionType;
  cleanupStatus?: MailCleanupStatus;
  cleanupConfig?: Partial<CleanupConfig> | null;
  displaySubject?: string | null;
  displayFrom?: string | null;
  summary?: string | null;
  reason?: string | null;
  dueAt?: string | null;
  deferredUntil?: string | null;
  priority?: MailActionPriority;
  tags?: string[];
  todoistSyncStatus?: TodoistSyncStatus;
};

export type UpdateMailActionInput = {
  actionId: string;
  expectedRevision: number;
  status?: MailActionStatus;
  actionType?: MailActionType;
  cleanupStatus?: MailCleanupStatus;
  cleanupConfig?: Partial<CleanupConfig> | null;
  summary?: string | null;
  reason?: string | null;
  dueAt?: string | null;
  deferredUntil?: string | null;
  priority?: MailActionPriority;
  tags?: string[];
  todoistSyncStatus?: TodoistSyncStatus;
  todoistTaskId?: string | null;
};

export type RecordMailActionLocationInput = {
  actionId: string;
  expectedRevision: number;
  mailbox: string;
  uid: number | null;
  uidValidity?: string | null;
  uidValidityUsable?: boolean;
};

export type TodoistSyncResultInput = {
  actionId: string;
  expectedRevision: number;
  todoistTaskId?: string | null;
  todoistSyncStatus: TodoistSyncStatus;
};

export type SearchMailActionsInput = {
  statuses?: MailActionStatus[];
  actionTypes?: MailActionType[];
  mailbox?: string;
  tags?: string[];
  dueBefore?: string;
  deferredBefore?: string;
  todoistSyncStatus?: TodoistSyncStatus;
  limit: number;
};

export type MailAction = {
  id: string;
  status: MailActionStatus;
  actionType: MailActionType;
  cleanupStatus: MailCleanupStatus;
  cleanupConfig: CleanupConfig;
  mailbox: string;
  sourceMailbox: string | null;
  legacyMailbox: string | null;
  uid: number | null;
  uidValidity: string | null;
  uidValidityUsable: boolean;
  messageId: string | null;
  mailFingerprint: string;
  subjectHash: string | null;
  fromHash: string | null;
  displaySubject: string | null;
  displayFrom: string | null;
  displayDate: string | null;
  displaySize: number | null;
  summary: string | null;
  reason: string | null;
  dueAt: string | null;
  deferredUntil: string | null;
  priority: MailActionPriority;
  tags: string[];
  todoistTaskId: string | null;
  todoistSyncStatus: TodoistSyncStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  completedAt: string | null;
  revision: number;
};

export type MailActionEvent = {
  id: string;
  actionId: string;
  eventType: string;
  beforeStatus: MailActionStatus | null;
  afterStatus: MailActionStatus | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type MailActionDetail = MailAction & {
  events: MailActionEvent[];
};

export type MailActionMutationResult = {
  action: MailAction;
};

export type TodoistExportCandidate = {
  actionId: string;
  revision: number;
  taskTitle: string;
  taskNote: string;
  dueAt: string | null;
  priority: MailActionPriority;
  tags: string[];
};

export interface LedgerStore {
  searchMailActions(input: SearchMailActionsInput): MailAction[];
  getMailAction(actionId: string): MailActionDetail;
  upsertMailAction(input: UpsertMailActionInput): MailActionMutationResult;
  updateMailAction(input: UpdateMailActionInput): MailActionMutationResult;
  recordMailActionLocation(input: RecordMailActionLocationInput): MailActionMutationResult;
  getTodoistExportCandidates(limit: number): TodoistExportCandidate[];
  recordTodoistSyncResult(input: TodoistSyncResultInput): MailActionMutationResult;
}
