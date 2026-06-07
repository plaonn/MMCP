import { describe, expect, it } from "vitest";

import { addTopLevelToolSecuritySchemes } from "../src/tool-security.js";

describe("tool security compatibility", () => {
  it("tools/list 응답에 top-level OAuth security scheme를 추가함", () => {
    const message = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: {
        tools: [
          { name: "search_emails", inputSchema: { type: "object" } },
          { name: "get_emails", inputSchema: { type: "object" } },
          { name: "move_emails", inputSchema: { type: "object" } },
          { name: "get_server_capabilities", inputSchema: { type: "object" } },
          { name: "trash_emails", inputSchema: { type: "object" } },
          { name: "get_mail_policy", inputSchema: { type: "object" } },
          { name: "get_bulk_operation_diagnostics", inputSchema: { type: "object" } },
          { name: "apply_mail_policy_patch", inputSchema: { type: "object" } }
        ]
      }
    };

    expect(addTopLevelToolSecuritySchemes(message)).toMatchObject({
      result: {
        tools: [
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }] },
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }] },
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.modify"] }] },
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }] },
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.modify"] }] },
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }] },
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.read"] }] },
          { securitySchemes: [{ type: "oauth2", scopes: ["mail.modify"] }] }
        ]
      }
    });
  });
});
