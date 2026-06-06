import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";

import { ImapEmailReader } from "../src/email/imap-reader.js";

describe("IMAP 이메일 검색", () => {
  it("문자열 envelope 날짜를 ISO 문자열로 정규화함", async () => {
    const reader = createReader(createFakeClient("2026-06-06T01:02:03.000Z"));

    const result = await reader.searchEmails({ mailbox: "INBOX", limit: 1 });

    expect(result[0]?.date).toBe("2026-06-06T01:02:03.000Z");
  });

  it("해석할 수 없는 envelope 날짜를 null로 반환함", async () => {
    const reader = createReader(createFakeClient("not-a-date"));

    const result = await reader.searchEmails({ mailbox: "INBOX", limit: 1 });

    expect(result[0]?.date).toBeNull();
  });
});

function createReader(client: ImapFlow): ImapEmailReader {
  return new ImapEmailReader({
    host: "imap.naver.com",
    port: 993,
    secure: true,
    user: "user@naver.com",
    password: "secret",
    maxEmailBytes: 5 * 1024 * 1024,
    createClient: () => client
  });
}

function createFakeClient(date: unknown): ImapFlow {
  return {
    usable: true,
    connect: vi.fn(async () => undefined),
    logout: vi.fn(async () => true),
    close: vi.fn(),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    search: vi.fn(async () => [42]),
    fetch: async function* () {
      yield {
        uid: 42,
        envelope: {
          date,
          from: [],
          to: []
        },
        flags: new Set(),
        size: 1024
      };
    }
  } as unknown as ImapFlow;
}
