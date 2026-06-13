export const bulkOperationStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "uncertain"
] as const;

export type BulkOperationStatus = typeof bulkOperationStatuses[number];

export type JournaledBulkOperation = {
  id: string;
  status: BulkOperationStatus;
  arguments: Record<string, unknown>;
  errorCode: string | null;
  error: string | null;
};

export type JournaledBulk = {
  bulkId: string;
  tool: string;
  status: BulkOperationStatus;
  createdAt: string;
  updatedAt: string;
  operations: JournaledBulkOperation[];
};

export interface BulkJournalStore {
  beginBulk(
    bulkId: string,
    tool: string,
    operations: Array<{ id: string } & Record<string, unknown>>
  ): { created: boolean; bulk: JournaledBulk };
  getBulk(bulkId: string): JournaledBulk;
  claimPending(bulkId: string, operationId: string): boolean;
  claimUncertain(bulkId: string, operationId: string): boolean;
  markSucceeded(bulkId: string, operationId: string): void;
  markFailed(bulkId: string, operationId: string, code: string, error: string): void;
  recoverRunning(): number;
  close(): void;
}
