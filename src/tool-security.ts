import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export const toolScopes: Record<string, "mail.read" | "mail.modify"> = {
  get_mail_rules: "mail.read",
  get_bulk_operation_diagnostics: "mail.read",
  preview_mail_rules_patch: "mail.read",
  apply_mail_rules_patch: "mail.modify",
  get_mail_rules_history: "mail.read",
  revert_mail_rules_revision: "mail.modify",
  check_connection: "mail.read",
  get_server_capabilities: "mail.read",
  get_quota: "mail.read",
  list_mailboxes: "mail.read",
  get_mailbox_status: "mail.read",
  search_emails: "mail.read",
  get_email: "mail.read",
  get_emails: "mail.read",
  get_email_headers: "mail.read",
  get_email_source: "mail.read",
  search_mail_actions: "mail.read",
  get_mail_action: "mail.read",
  get_todoist_export_candidates: "mail.read",
  upsert_mail_actions: "mail.modify",
  record_mail_action_candidates: "mail.modify",
  update_mail_actions: "mail.modify",
  record_mail_action_location: "mail.modify",
  record_todoist_sync_results: "mail.modify",
  set_emails_read_status: "mail.modify",
  set_emails_flagged_status: "mail.modify",
  copy_emails: "mail.modify",
  move_emails: "mail.modify",
  trash_emails: "mail.modify",
  mark_emails_as_spam: "mail.modify",
  create_mailbox: "mail.modify",
  rename_mailbox: "mail.modify",
  set_mailbox_subscription: "mail.modify"
};

export function securitySchemes(scope: string) {
  return [{ type: "oauth2", scopes: [scope] }];
}

export function addTopLevelToolSecuritySchemes(message: JSONRPCMessage): JSONRPCMessage {
  if (!("result" in message)) {
    return message;
  }

  const result = message.result as { tools?: Array<Record<string, unknown>> };
  if (!Array.isArray(result.tools)) {
    return message;
  }

  for (const tool of result.tools) {
    const scope = typeof tool.name === "string" ? toolScopes[tool.name] : undefined;
    if (scope) {
      tool.securitySchemes = securitySchemes(scope);
    }
  }
  return message;
}
