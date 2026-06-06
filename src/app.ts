import { timingSafeEqual } from "node:crypto";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";

import type { Config } from "./config.js";
import type { EmailReader } from "./email/types.js";
import { createMcpServer } from "./mcp-server.js";

export function createApp(config: Config, emailReader: EmailReader) {
  const app = createMcpExpressApp({ host: config.host });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use("/mcp", (request, response, next) => {
    if (!hasValidBearerToken(request, config.bearerToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({ error: "인증되지 않은 요청임" });
      return;
    }
    next();
  });

  app.post("/mcp", async (request: Request, response: Response) => {
    const server = createMcpServer(emailReader);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

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

function hasValidBearerToken(request: Request, expectedToken: string): boolean {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedToken = authorization.slice("Bearer ".length);
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
