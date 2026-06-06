import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const validEnvironment = {
  MMCP_BEARER_TOKEN: "a".repeat(24),
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
  });

  it("필수 비밀값이 없으면 오류를 발생시킴", () => {
    expect(() => loadConfig({})).toThrow("필수 환경변수 설정이 올바르지 않음");
  });
});
