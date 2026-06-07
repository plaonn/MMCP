import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";

import type { Config } from "./config.js";
import type { EmailReader } from "./email/types.js";
import { SqliteLedgerStore } from "./ledger/sqlite-ledger-store.js";
import { createMcpServer } from "./mcp-server.js";
import { PersonalOAuthProvider } from "./oauth-provider.js";
import { PolicyStore } from "./policy-store.js";
import { addTopLevelToolSecuritySchemes } from "./tool-security.js";

export function createApp(config: Config, emailReader: EmailReader) {
  const app = createMcpExpressApp({ host: config.host });
  app.set("trust proxy", "loopback");
  const provider = new PersonalOAuthProvider({
    ...config.oauth,
    resourceUrl: config.publicUrl
  });
  const policyStore = new PolicyStore(config.policyPath);
  const ledgerStore = new SqliteLedgerStore(config.workflowDbPath);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.publicUrl);

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(config.publicUrl.origin),
    resourceServerUrl: config.publicUrl,
    scopesSupported: ["mail.read", "mail.modify"],
    resourceName: "MMCP 개인 메일"
  }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use("/mcp", rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false
  }));

  app.use("/mcp", requireBearerAuth({
    verifier: provider,
    requiredScopes: ["mail.read"],
    resourceMetadataUrl
  }));

  app.post("/mcp", async (request: Request, response: Response) => {
    response.setTimeout(60_000, () => {
      if (!response.headersSent) {
        response.status(504).json({ error: "MCP 요청 처리 시간이 초과됨" });
        return;
      }
      response.end();
    });

    const server = createMcpServer(emailReader, {
      grantedScopes: request.auth?.scopes ?? [],
      policyStore,
      ledgerStore
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    const send = transport.send.bind(transport);
    transport.send = (message, options) =>
      send(addTopLevelToolSecuritySchemes(message), options);

    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) {
        response.status(500).json({ error: "MCP 요청 처리에 실패함" });
      }
    }
  });

  app.get("/mcp", (_request, response) => {
    response.status(405).json({ error: "상태 비저장 MCP 서버는 GET을 지원하지 않음" });
  });

  app.delete("/mcp", (_request, response) => {
    response.status(405).json({ error: "상태 비저장 MCP 서버는 DELETE를 지원하지 않음" });
  });

  return app;
}
