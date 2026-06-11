import type { EmailSummary } from "../email/types.js";
import type {
  MailActionStatus,
  MailActionType,
  UpsertMailActionInput
} from "./types.js";

type MigrationMapping = {
  status: MailActionStatus;
  actionType: MailActionType;
  tags: string[];
};

const knownMappings: Record<string, MigrationMapping> = {
  "GPT 검토": {
    status: "candidate",
    actionType: "review",
    tags: ["migration:needs_review"]
  },
  "GPT 검토/확인 필요": {
    status: "candidate",
    actionType: "review",
    tags: ["migration:needs_review"]
  },
  "GPT 검토/MMCP 개선": {
    status: "actionable",
    actionType: "todoist_export",
    tags: ["migration:todoist_export_pending", "topic:mmcp"]
  },
  "GPT 검토/삭제": {
    status: "actionable",
    actionType: "mail_delete",
    tags: ["migration:mail_delete_pending", "decision:delete"]
  },
  "GPT 검토/삭제 예정": {
    status: "actionable",
    actionType: "mail_delete",
    tags: ["migration:mail_delete_pending", "decision:delete"]
  },
  "GPT 검토/보류": {
    status: "deferred",
    actionType: "follow_up",
    tags: []
  },
  "GPT 검토/나중에": {
    status: "deferred",
    actionType: "follow_up",
    tags: []
  },
  "GPT 검토/완료": {
    status: "done",
    actionType: "follow_up",
    tags: ["migration:resolved"]
  },
  "GPT 검토/처리 완료": {
    status: "done",
    actionType: "follow_up",
    tags: ["migration:resolved"]
  }
};

const unknownMapping: MigrationMapping = {
  status: "candidate",
  actionType: "review",
  tags: ["migration:needs_review", "migration:unknown_folder"]
};

export function mapGptReviewEmailToMailAction(
  email: EmailSummary,
  mailboxStatus?: {
    uidValidity: string | null;
    uidValidityUsable: boolean;
  }
): UpsertMailActionInput {
  if (email.mailbox !== "GPT 검토" && !email.mailbox.startsWith("GPT 검토/")) {
    throw new Error("GPT 검토 편지함 migration 대상이 아님");
  }

  const mapping = knownMappings[email.mailbox] ?? unknownMapping;
  return {
    mailbox: email.mailbox,
    sourceMailbox: email.mailbox,
    legacyMailbox: email.mailbox,
    uid: email.uid,
    uidValidity: mailboxStatus?.uidValidity ?? null,
    uidValidityUsable: Boolean(
      mailboxStatus?.uidValidityUsable && mailboxStatus.uidValidity
    ),
    messageId: email.messageId,
    subject: email.subject,
    from: email.from,
    date: email.date,
    size: email.size,
    displaySubject: email.subject,
    displayFrom: email.from.join(", "),
    status: mapping.status,
    actionType: mapping.actionType,
    tags: [...mapping.tags]
  };
}
