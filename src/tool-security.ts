import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export const toolScopes: Record<string, "mail.read" | "mail.modify"> = {
  get_mail_policy: "mail.read",
  preview_mail_policy_patch: "mail.read",
  apply_mail_policy_patch: "mail.modify",
  get_mail_policy_history: "mail.read",
  revert_mail_policy_revision: "mail.modify",
  check_connection: "mail.read",
  get_server_capabilities: "mail.read",
  get_quota: "mail.read",
  list_mailboxes: "mail.read",
  search_emails: "mail.read",
  get_email: "mail.read",
  get_email_headers: "mail.read",
  get_email_source: "mail.read",
  set_email_read_status: "mail.modify",
  set_email_flagged_status: "mail.modify",
  copy_email: "mail.modify",
  move_email: "mail.modify",
  trash_email: "mail.modify",
  mark_email_as_spam: "mail.modify",
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
