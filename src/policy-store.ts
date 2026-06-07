import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { z } from "zod";

const ruleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const ruleTextSchema = z.string().trim().min(1).max(2000);
const policyRuleSchema = z.object({
  id: ruleIdSchema,
  text: ruleTextSchema
});
const policySnapshotSchema = z.object({
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  rules: z.array(policyRuleSchema).max(100)
});
const policyFileSchema = z.object({
  version: z.literal(1),
  current: policySnapshotSchema,
  history: z.array(policySnapshotSchema).max(20)
});

export const policyPatchOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("add"),
    rule: policyRuleSchema
  }),
  z.object({
    operation: z.literal("replace"),
    ruleId: ruleIdSchema,
    text: ruleTextSchema
  }),
  z.object({
    operation: z.literal("remove"),
    ruleId: ruleIdSchema
  })
]);

export const policyPatchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operations: z.array(policyPatchOperationSchema).min(1).max(20)
});

export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicySnapshot = z.infer<typeof policySnapshotSchema>;
export type PolicyPatch = z.infer<typeof policyPatchSchema>;

export type PolicyDiffEntry = {
  operation: "add" | "replace" | "remove";
  ruleId: string;
  before: string | null;
  after: string | null;
};

export type PolicyPatchPreview = {
  currentRevision: number;
  nextRevision: number;
  diff: PolicyDiffEntry[];
  policy: PolicySnapshot;
};

export class PolicyStore {
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  getPolicy(): PolicySnapshot {
    return cloneSnapshot(this.readStore().current);
  }

  getHistory(limit = 10): PolicySnapshot[] {
    const parsedLimit = z.number().int().min(1).max(20).parse(limit);
    return this.readStore().history.slice(-parsedLimit).reverse().map(cloneSnapshot);
  }

  previewPatch(input: PolicyPatch): PolicyPatchPreview {
    const patch = policyPatchSchema.parse(input);
    const current = this.readStore().current;
    return buildPatchPreview(current, patch);
  }

  applyPatch(input: PolicyPatch): Promise<PolicyPatchPreview> {
    return this.mutate(() => {
      const store = this.readStore();
      const patch = policyPatchSchema.parse(input);
      const preview = buildPatchPreview(store.current, patch);
      this.writeStore({
        version: 1,
        current: preview.policy,
        history: trimHistory([...store.history, preview.policy])
      });
      return preview;
    });
  }

  revertPolicy(expectedRevision: number, targetRevision: number): Promise<PolicyPatchPreview> {
    return this.mutate(() => {
      const store = this.readStore();
      if (store.current.revision !== expectedRevision) {
        throw new Error("규칙 revision이 최신 상태와 일치하지 않음");
      }
      const target = store.history.find((snapshot) => snapshot.revision === targetRevision);
      if (!target) {
        throw new Error("복원할 규칙 revision을 찾을 수 없음");
      }
      const next = {
        revision: store.current.revision + 1,
        updatedAt: new Date().toISOString(),
        rules: target.rules.map((rule) => ({ ...rule }))
      };
      const preview = {
        currentRevision: store.current.revision,
        nextRevision: next.revision,
        diff: diffRules(store.current.rules, next.rules),
        policy: next
      };
      this.writeStore({
        version: 1,
        current: next,
        history: trimHistory([...store.history, next])
      });
      return preview;
    });
  }

  private mutate<T>(operation: () => T): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private readStore(): z.infer<typeof policyFileSchema> {
    if (!existsSync(this.path)) {
      const defaultPolicy = createDefaultPolicy();
      const initial = {
        version: 1 as const,
        current: defaultPolicy,
        history: [defaultPolicy]
      };
      this.writeStore(initial);
      return initial;
    }
    return policyFileSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
  }

  private writeStore(store: z.infer<typeof policyFileSchema>): void {
    const parsed = policyFileSchema.parse(store);
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, this.path);
    chmodSync(this.path, 0o600);
  }
}

function createDefaultPolicy(): PolicySnapshot {
  return {
    revision: 1,
    updatedAt: new Date().toISOString(),
    rules: [
      {
        id: "ask-when-uncertain",
        text: "메일 관리 판단이 애매하면 상태를 변경하지 말고 사용자에게 질문함."
      }
    ]
  };
}

function buildPatchPreview(current: PolicySnapshot, patch: PolicyPatch): PolicyPatchPreview {
  if (current.revision !== patch.expectedRevision) {
    throw new Error("규칙 revision이 최신 상태와 일치하지 않음");
  }

  const rules = current.rules.map((rule) => ({ ...rule }));
  for (const operation of patch.operations) {
    const index = rules.findIndex((rule) =>
      rule.id === (operation.operation === "add" ? operation.rule.id : operation.ruleId)
    );
    if (operation.operation === "add") {
      if (index >= 0) throw new Error("같은 ID의 메일 관리 규칙이 이미 존재함");
      rules.push({ ...operation.rule });
    } else if (operation.operation === "replace") {
      if (index < 0) throw new Error("수정할 메일 관리 규칙을 찾을 수 없음");
      rules[index] = { id: operation.ruleId, text: operation.text };
    } else {
      if (index < 0) throw new Error("삭제할 메일 관리 규칙을 찾을 수 없음");
      rules.splice(index, 1);
    }
  }

  const next = {
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    rules
  };
  policySnapshotSchema.parse(next);
  return {
    currentRevision: current.revision,
    nextRevision: next.revision,
    diff: diffRules(current.rules, next.rules),
    policy: next
  };
}

function diffRules(before: PolicyRule[], after: PolicyRule[]): PolicyDiffEntry[] {
  const beforeById = new Map(before.map((rule) => [rule.id, rule.text]));
  const afterById = new Map(after.map((rule) => [rule.id, rule.text]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  return [...ids].flatMap((ruleId) => {
    const previous = beforeById.get(ruleId) ?? null;
    const next = afterById.get(ruleId) ?? null;
    if (previous === next) return [];
    return [{
      operation: previous === null ? "add" as const : next === null ? "remove" as const : "replace" as const,
      ruleId,
      before: previous,
      after: next
    }];
  });
}

function trimHistory(history: PolicySnapshot[]): PolicySnapshot[] {
  return history.slice(-20).map(cloneSnapshot);
}

function cloneSnapshot(snapshot: PolicySnapshot): PolicySnapshot {
  return {
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    rules: snapshot.rules.map((rule) => ({ ...rule }))
  };
}
