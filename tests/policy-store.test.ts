import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PolicyStore, policyPatchSchema } from "../src/policy-store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("메일 관리 정책 저장소", () => {
  it("기본 정책을 저장소 외부 파일에 600 권한으로 생성함", () => {
    const { path, store } = createStore();

    expect(store.getPolicy()).toMatchObject({
      revision: 1,
      rules: [{ id: "ask-when-uncertain" }]
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("patch 미리보기는 파일과 revision을 변경하지 않음", () => {
    const { path, store } = createStore();
    store.getPolicy();
    const before = readFileSync(path, "utf8");

    const preview = store.previewPatch({
      expectedRevision: 1,
      operations: [{
        operation: "add",
        rule: { id: "protect-personal", text: "개인 메일은 신중하게 처리함." }
      }]
    });

    expect(preview).toMatchObject({
      currentRevision: 1,
      nextRevision: 2,
      diff: [{ operation: "add", ruleId: "protect-personal" }]
    });
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(store.getPolicy().revision).toBe(1);
  });

  it("patch 적용과 revision 충돌 거부 및 복원을 지원함", async () => {
    const { store } = createStore();

    await store.applyPatch({
      expectedRevision: 1,
      operations: [{
        operation: "replace",
        ruleId: "ask-when-uncertain",
        text: "애매하면 사용자에게 먼저 질문함."
      }]
    });
    await expect(store.applyPatch({
      expectedRevision: 1,
      operations: [{
        operation: "remove",
        ruleId: "ask-when-uncertain"
      }]
    })).rejects.toThrow("revision");

    const reverted = await store.revertPolicy(2, 1);
    expect(reverted).toMatchObject({
      currentRevision: 2,
      nextRevision: 3,
      diff: [{ operation: "replace", ruleId: "ask-when-uncertain" }]
    });
    expect(store.getHistory().map((snapshot) => snapshot.revision)).toEqual([3, 2, 1]);
  });

  it("정책 전문 교체 operation을 허용하지 않음", () => {
    expect(() => policyPatchSchema.parse({
      expectedRevision: 1,
      operations: [{ operation: "replace_all", rules: [] }]
    })).toThrow();
  });
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "mmcp-policy-test-"));
  directories.push(directory);
  const path = join(directory, "policy.json");
  return { path, store: new PolicyStore(path) };
}
