import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export const toolScopes: Record<string, "mail.read" | "mail.modify"> = {
  check_connection: "mail.read",
  list_mailboxes: "mail.read",
  search_emails: "mail.read",
  get_email: "mail.read",
  set_email_read_status: "mail.modify",
  move_email: "mail.modify"
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
