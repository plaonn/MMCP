import { describe, expect, it } from "vitest";

import type { EmailSummary } from "../src/email/types.js";
import { mapGptReviewEmailToMailAction } from "../src/ledger/gpt-review-migration.js";

const mappings = [
  ["GPT 검토", "candidate", "review", ["migration:needs_review"]],
  ["GPT 검토/확인 필요", "candidate", "review", ["migration:needs_review"]],
  [
    "GPT 검토/MMCP 개선",
    "actionable",
    "todoist_export",
    ["migration:todoist_export_pending", "topic:mmcp"]
  ],
  [
    "GPT 검토/삭제",
    "actionable",
    "mail_delete",
    ["migration:mail_delete_pending", "decision:delete"]
  ],
  [
    "GPT 검토/삭제 예정",
    "actionable",
    "mail_delete",
    ["migration:mail_delete_pending", "decision:delete"]
  ],
  ["GPT 검토/보류", "deferred", "follow_up", []],
  ["GPT 검토/나중에", "deferred", "follow_up", []],
  ["GPT 검토/완료", "done", "follow_up", ["migration:resolved"]],
  ["GPT 검토/처리 완료", "done", "follow_up", ["migration:resolved"]]
] as const;

describe("GPT 검토 migration mapping", () => {
  it.each(mappings)("%s 편지함을 정규 상태와 tag로 변환함", (
    mailbox,
    status,
    actionType,
    tags
  ) => {
    const result = mapGptReviewEmailToMailAction(email(mailbox), {
      uidValidity: "123",
      uidValidityUsable: true
    });

    expect(result).toMatchObject({
      mailbox,
      sourceMailbox: mailbox,
      legacyMailbox: mailbox,
      uid: 42,
      uidValidity: "123",
      uidValidityUsable: true,
      status,
      actionType,
      tags: [...tags]
    });
  });

  it("알 수 없는 하위 편지함은 확인 필요 상태로 남김", () => {
    expect(mapGptReviewEmailToMailAction(email("GPT 검토/새 분류"))).toMatchObject({
      status: "candidate",
      actionType: "review",
      tags: ["migration:needs_review", "migration:unknown_folder"]
    });
  });

  it("uidValidity 0과 대상 밖 편지함을 안전하게 처리함", () => {
    expect(mapGptReviewEmailToMailAction(email("GPT 검토"), {
      uidValidity: "0",
      uidValidityUsable: false
    })).toMatchObject({
      uidValidity: "0",
      uidValidityUsable: false
    });
    expect(() => mapGptReviewEmailToMailAction(email("INBOX")))
      .toThrow("GPT 검토 편지함 migration 대상이 아님");
  });
});

function email(mailbox: string): EmailSummary {
  return {
    mailbox,
    uid: 42,
    messageId: "<message@example.com>",
    subject: "후속 조치",
    from: ["sender@example.com"],
    to: ["recipient@example.com"],
    date: "2026-06-11T00:00:00.000Z",
    size: 2048,
    flags: [],
    hasAttachments: false
  };
}
