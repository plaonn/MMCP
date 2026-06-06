import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";

import { ImapEmailReader } from "../src/email/imap-reader.js";

describe("IMAP 추가 조회 기능", () => {
  it("capability와 특수 편지함 지원을 정규화함", async () => {
    const client = createFakeClient();
    const reader = createReader(client);

    await expect(reader.getServerCapabilities()).resolves.toEqual({
      capabilities: ["MOVE", "QUOTA", "THREAD=REFERENCES"],
      specialUses: ["\\Inbox", "\\Trash"],
      features: {
        idle: false,
        move: true,
        quota: true,
        sort: false,
        thread: true
      }
    });
  });

  it("quota 저장 용량과 비율을 반환함", async () => {
    const client = createFakeClient();
    const reader = createReader(client);

    await expect(reader.getQuota("INBOX")).resolves.toEqual({
      supported: true,
      mailbox: "INBOX",
      storage: {
        used: 250,
        limit: 1000,
        percent: 25
      }
    });
  });

  it("이메일 헤더와 원본을 텍스트로 반환함", async () => {
    const client = createFakeClient();
    const reader = createReader(client);

    await expect(reader.getEmailHeaders("INBOX", 42)).resolves.toEqual({
      mailbox: "INBOX",
      uid: 42,
      headers: "Subject: test\r\n"
    });
    await expect(reader.getEmailSource("INBOX", 42)).resolves.toEqual({
      mailbox: "INBOX",
      uid: 42,
      source: "Subject: test\r\n\r\nbody"
    });
  });
});

function createReader(client: ImapFlow): ImapEmailReader {
  return new ImapEmailReader({
    host: "imap.naver.com",
    port: 993,
    secure: true,
    user: "user@naver.com",
    password: "secret",
    maxEmailBytes: 1024,
    createClient: () => client
  });
}

function createFakeClient(): ImapFlow {
  return {
    usable: true,
    capabilities: new Map([
      ["MOVE", true],
      ["QUOTA", true],
      ["THREAD=REFERENCES", true]
    ]),
    connect: vi.fn(async () => undefined),
    logout: vi.fn(async () => true),
    close: vi.fn(),
    list: vi.fn(async () => [
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "Trash", specialUse: "\\Trash" }
    ]),
    getQuota: vi.fn(async () => ({
      path: "INBOX",
      storage: { used: 250, limit: 1000 }
    })),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    fetchOne: vi.fn(async (_uid, query: { headers?: boolean; source?: boolean }) => ({
      uid: 42,
      ...(query.headers ? { headers: Buffer.from("Subject: test\r\n") } : {}),
      ...(query.source ? { source: Buffer.from("Subject: test\r\n\r\nbody") } : {})
    }))
  } as unknown as ImapFlow;
}
