import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/config.js";

const validEnvironment = {
  MMCP_PUBLIC_URL: "https://mail.example.com/mcp",
  MMCP_OAUTH_OWNER_PASSWORD: "p".repeat(16),
  MMCP_OAUTH_SIGNING_SECRET: "s".repeat(32),
  IMAP_USER: "user@naver.com",
  IMAP_PASSWORD: "application-password"
};

describe("loadConfig", () => {
  it("기본 네이버 IMAP 설정을 사용함", () => {
    const config = loadConfig(validEnvironment);

    expect(config.imap).toEqual({
      host: "imap.naver.com",
      port: 993,
      secure: true,
      user: "user@naver.com",
      password: "application-password"
    });
    expect(config.maxEmailBytes).toBe(5 * 1024 * 1024);
    expect(config.publicUrl.href).toBe("https://mail.example.com/mcp");
    expect(config.policyPath).toBe(join(homedir(), ".config/mmcp/mail-policy.json"));
    expect(config.workflowDbPath).toBe(join(homedir(), ".config/mmcp/workflow.sqlite"));
  });

  it("필수 비밀값이 없으면 오류를 발생시킴", () => {
    expect(() => loadConfig({})).toThrow("필수 환경변수 설정이 올바르지 않음");
  });
});
