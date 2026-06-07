import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";

import { ImapEmailReader } from "../src/email/imap-reader.js";

describe("IMAP 이메일 검색", () => {
  it("문자열 envelope 날짜를 ISO 문자열로 정규화함", async () => {
    const fake = createFakeClient({ date: "2026-06-06T01:02:03.000Z" });
    const reader = createReader(fake.client);

    const result = await reader.searchEmails({ mailbox: "INBOX", limit: 1 });

    expect(result[0]?.date).toBe("2026-06-06T01:02:03.000Z");
  });

  it("해석할 수 없는 envelope 날짜를 null로 반환함", async () => {
    const fake = createFakeClient({ date: "not-a-date" });
    const reader = createReader(fake.client);

    const result = await reader.searchEmails({ mailbox: "INBOX", limit: 1 });

    expect(result[0]?.date).toBeNull();
  });

  it("UID cursor와 별표 및 크기 조건을 IMAP 검색 조건으로 변환함", async () => {
    const fake = createFakeClient({ matchedUids: [39, 42, 41, 40] });
    const reader = createReader(fake.client);

    const result = await reader.searchEmails({
      mailbox: "INBOX",
      subject: "청구서",
      unread: true,
      flagged: false,
      minSize: 1_024,
      maxSize: 10_485_760,
      olderThanUid: 50,
      limit: 3
    });

    expect(fake.search).toHaveBeenCalledWith({
      subject: "청구서",
      seen: false,
      flagged: false,
      larger: 1_023,
      smaller: 10_485_761,
      uid: "1:49"
    }, { uid: true });
    expect(fake.fetch).toHaveBeenCalledWith(
      [42, 41, 40],
      expect.objectContaining({
        uid: true,
        envelope: true,
        flags: true,
        size: true,
        bodyStructure: true
      }),
      { uid: true }
    );
    expect(result.map(({ uid }) => uid)).toEqual([42, 41, 40]);
  });

  it("0 byte 최소 크기는 불필요한 IMAP LARGER 조건을 추가하지 않음", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await reader.searchEmails({ mailbox: "INBOX", minSize: 0, limit: 1 });

    expect(fake.search).toHaveBeenCalledWith({ all: true }, { uid: true });
  });

  it.each([true, false])("별표 상태 %s를 IMAP 검색 조건에 전달함", async (flagged) => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await reader.searchEmails({ mailbox: "INBOX", flagged, limit: 1 });

    expect(fake.search).toHaveBeenCalledWith({ flagged }, { uid: true });
  });

  it("마지막 결과 UID를 다음 cursor로 사용하면 페이지가 중복되지 않음", async () => {
    const firstFake = createFakeClient({ matchedUids: [7, 8, 9, 10] });
    const secondFake = createFakeClient({ matchedUids: [6, 7, 8] });

    const firstPage = await createReader(firstFake.client).searchEmails({
      mailbox: "INBOX",
      limit: 2
    });
    const secondPage = await createReader(secondFake.client).searchEmails({
      mailbox: "INBOX",
      olderThanUid: firstPage.at(-1)!.uid,
      limit: 2
    });

    expect(firstPage.map(({ uid }) => uid)).toEqual([10, 9]);
    expect(secondFake.search).toHaveBeenCalledWith({ uid: "1:8" }, { uid: true });
    expect(secondPage.map(({ uid }) => uid)).toEqual([8, 7]);
    expect(secondPage.some(({ uid }) => firstPage.some((email) => email.uid === uid))).toBe(false);
  });

  it("가장 오래된 UID 다음 페이지는 편지함만 확인하고 빈 배열을 반환함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    const result = await reader.searchEmails({
      mailbox: "INBOX",
      olderThanUid: 1,
      limit: 20
    });

    expect(result).toEqual([]);
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(fake.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(fake.search).not.toHaveBeenCalled();
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it("검색 결과는 기존 메타데이터 배열만 UID 내림차순으로 반환함", async () => {
    const fake = createFakeClient({ matchedUids: [7, 9, 8] });
    const reader = createReader(fake.client);

    const result = await reader.searchEmails({ mailbox: "INBOX", limit: 3 });

    expect(result.map(({ uid }) => uid)).toEqual([9, 8, 7]);
    expect(result[0]).toEqual({
      mailbox: "INBOX",
      uid: 9,
      messageId: null,
      subject: null,
      from: [],
      to: [],
      date: "2026-06-06T01:02:03.000Z",
      size: 1_024,
      flags: [],
      hasAttachments: false
    });
    expect(result[0]).not.toHaveProperty("text");
    expect(result[0]).not.toHaveProperty("attachments");
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

function createFakeClient(options: {
  date?: unknown;
  matchedUids?: number[];
} = {}) {
  const connect = vi.fn(async () => undefined);
  const search = vi.fn(async () => options.matchedUids ?? [42]);
  const getMailboxLock = vi.fn(async () => ({ release: vi.fn() }));
  const fetch = vi.fn(async function* (uids: number[]) {
    for (const uid of [...uids].reverse()) {
      yield {
        uid,
        envelope: {
          date: options.date ?? "2026-06-06T01:02:03.000Z",
          from: [],
          to: []
        },
        flags: new Set(),
        size: 1_024
      };
    }
  });
  const client = {
    usable: true,
    connect,
    logout: vi.fn(async () => true),
    close: vi.fn(),
    getMailboxLock,
    search,
    fetch
  } as unknown as ImapFlow;

  return { client, connect, getMailboxLock, search, fetch };
}
