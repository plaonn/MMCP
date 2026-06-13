import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";

import { ImapEmailReader } from "../src/email/imap-reader.js";

const mailboxes = [
  {
    path: "INBOX",
    name: "INBOX",
    specialUse: "\\Inbox",
    subscribed: true
  },
  {
    path: "Target",
    name: "Target",
    subscribed: true
  },
  {
    path: "Trash",
    name: "Trash",
    specialUse: "\\Trash",
    subscribed: true
  },
  {
    path: "Spam",
    name: "Spam",
    specialUse: "\\Junk",
    subscribed: true
  }
];

describe("IMAP 이메일 상태 관리", () => {
  it("편지함 상태를 bigint-safe 문자열과 숫자로 반환함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.getMailboxStatus("INBOX")).resolves.toEqual({
      mailbox: "INBOX",
      uidValidity: "12345678901234567890",
      uidValidityUsable: true,
      uidNext: 43,
      exists: 10,
      highestModseq: "999999999999999999"
    });
    expect(fake.status).toHaveBeenCalledWith("INBOX", {
      messages: true,
      uidNext: true,
      uidValidity: true,
      highestModseq: true
    });
  });

  it("UIDVALIDITY 0은 ledger 위치 매칭에 사용할 수 없는 값으로 표시함", async () => {
    const fake = createFakeClient();
    fake.status.mockResolvedValueOnce({
      path: "INBOX",
      uidValidity: 0n
    });
    const reader = createReader(fake.client);

    await expect(reader.getMailboxStatus("INBOX")).resolves.toEqual({
      mailbox: "INBOX",
      uidValidity: "0",
      uidValidityUsable: false,
      uidNext: null,
      exists: 0,
      highestModseq: null
    });
  });

  it("읽음 상태에 따라 Seen flag를 추가하거나 제거함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.setEmailReadStatus("INBOX", 42, true)).resolves.toEqual({
      mailbox: "INBOX",
      uid: 42,
      read: true
    });
    await expect(reader.setEmailReadStatus("INBOX", 42, false)).resolves.toEqual({
      mailbox: "INBOX",
      uid: 42,
      read: false
    });

    expect(fake.messageFlagsAdd).toHaveBeenCalledWith(42, ["\\Seen"], { uid: true });
    expect(fake.messageFlagsRemove).toHaveBeenCalledWith(42, ["\\Seen"], { uid: true });
  });

  it("복구용 이메일 상태 조회는 본문 없이 flags만 요청함", async () => {
    const fake = createFakeClient();
    fake.fetchOne.mockResolvedValueOnce({
      uid: 42,
      flags: new Set(["\\Seen", "\\Flagged"])
    });
    const reader = createReader(fake.client);

    await expect(reader.getEmailState("INBOX", 42)).resolves.toEqual({
      mailbox: "INBOX",
      uid: 42,
      read: true,
      flagged: true
    });
    expect(fake.fetchOne).toHaveBeenCalledWith(
      42,
      { uid: true, flags: true },
      { uid: true }
    );
  });

  it("명시한 편지함으로 이동하고 새 UID를 반환함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.moveEmail("INBOX", 42, "Target")).resolves.toEqual({
      sourceMailbox: "INBOX",
      sourceUid: 42,
      destinationMailbox: "Target",
      destinationUid: 84
    });
    expect(fake.messageMove).toHaveBeenCalledWith(42, "Target", { uid: true });
  });

  it("서버가 이동 성공을 반환해도 출발지에서 사라지지 않으면 실패함", async () => {
    const fake = createFakeClient();
    fake.messageMove.mockImplementationOnce(async (_uid: number, destination: string) => ({
      path: "INBOX",
      destination,
      uidMap: new Map([[42, 84]])
    }));
    const reader = createReader(fake.client);

    await expect(reader.moveEmail("INBOX", 42, "Target")).rejects.toThrow(
      "이메일 이동 결과를 확인할 수 없음"
    );
  });

  it("이메일을 복사하고 새 UID를 반환함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.copyEmail("INBOX", 42, "Target")).resolves.toEqual({
      sourceMailbox: "INBOX",
      sourceUid: 42,
      destinationMailbox: "Target",
      destinationUid: 84
    });
    expect(fake.messageCopy).toHaveBeenCalledWith(42, "Target", { uid: true });
  });

  it("별표 상태에 따라 Flagged flag를 추가하거나 제거함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.setEmailFlaggedStatus("INBOX", 42, true)).resolves.toEqual({
      mailbox: "INBOX",
      uid: 42,
      flagged: true
    });
    await expect(reader.setEmailFlaggedStatus("INBOX", 42, false)).resolves.toEqual({
      mailbox: "INBOX",
      uid: 42,
      flagged: false
    });

    expect(fake.messageFlagsAdd).toHaveBeenCalledWith(42, ["\\Flagged"], { uid: true });
    expect(fake.messageFlagsRemove).toHaveBeenCalledWith(42, ["\\Flagged"], { uid: true });
  });

  it("휴지통과 스팸 특수 편지함으로 이동함", async () => {
    const trashReader = createReader(createFakeClient().client);
    const spamReader = createReader(createFakeClient().client);

    await expect(trashReader.trashEmail("INBOX", 42)).resolves.toMatchObject({
      destinationMailbox: "Trash"
    });
    await expect(spamReader.markEmailAsSpam("INBOX", 42)).resolves.toMatchObject({
      destinationMailbox: "Spam"
    });
  });

  it("휴지통, 스팸, 같은 편지함, 존재하지 않는 편지함으로 일반 이동을 거부함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.moveEmail("INBOX", 42, "Trash")).rejects.toThrow(
      "휴지통과 스팸 편지함은 전용 도구로만 이동할 수 있음"
    );
    await expect(reader.moveEmail("INBOX", 42, "Spam")).rejects.toThrow(
      "휴지통과 스팸 편지함은 전용 도구로만 이동할 수 있음"
    );
    await expect(reader.moveEmail("INBOX", 42, "INBOX")).rejects.toThrow(
      "같은 편지함으로 이동할 수 없음"
    );
    await expect(reader.moveEmail("INBOX", 42, "Missing")).rejects.toThrow(
      "대상 편지함을 찾을 수 없음"
    );
    expect(fake.messageMove).not.toHaveBeenCalled();
  });

  it("사용자 편지함을 생성하고 이름과 구독 상태를 변경함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.createMailbox("New")).resolves.toEqual({
      path: "New",
      created: true
    });
    await expect(reader.renameMailbox("Target", "Renamed")).resolves.toEqual({
      path: "Target",
      newPath: "Renamed"
    });
    await expect(reader.setMailboxSubscription("Target", false)).resolves.toEqual({
      path: "Target",
      subscribed: false
    });

    expect(fake.mailboxCreate).toHaveBeenCalledWith("New");
    expect(fake.mailboxRename).toHaveBeenCalledWith("Target", "Renamed");
    expect(fake.mailboxUnsubscribe).toHaveBeenCalledWith("Target");
  });

  it("특수 편지함 이름 변경을 거부함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.renameMailbox("Trash", "Gone")).rejects.toThrow(
      "특수 편지함 이름은 변경할 수 없음"
    );
    expect(fake.mailboxRename).not.toHaveBeenCalled();
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

function createFakeClient(mailboxList = mailboxes) {
  let selectedMailbox = "";
  const missingMessages = new Set<string>();
  const messageFlagsAdd = vi.fn(async () => true);
  const messageFlagsRemove = vi.fn(async () => true);
  const messageMove = vi.fn(async (uid: number, destination: string) => {
    missingMessages.add(`${selectedMailbox}\0${uid}`);
    return {
      path: selectedMailbox,
      destination,
      uidMap: new Map([[uid, 84]])
    };
  });
  const messageCopy = vi.fn(async (_uid: number, destination: string) => ({
    path: "INBOX",
    destination,
    uidMap: new Map([[42, 84]])
  }));
  const mailboxCreate = vi.fn(async (path: string) => ({ path, created: true }));
  const mailboxRename = vi.fn(async (path: string, newPath: string) => ({ path, newPath }));
  const mailboxSubscribe = vi.fn(async () => true);
  const mailboxUnsubscribe = vi.fn(async () => true);
  const status = vi.fn(async (mailbox: string): Promise<{
    path: string;
    uidValidity?: bigint;
    uidNext?: number;
    messages?: number;
    highestModseq?: bigint;
  }> => ({
    path: mailbox,
    uidValidity: 12345678901234567890n,
    uidNext: 43,
    messages: 10,
    highestModseq: 999999999999999999n
  }));
  const fetchOne = vi.fn(async (
    uid: number
  ): Promise<false | { uid: number; flags?: Set<string> }> =>
    missingMessages.has(`${selectedMailbox}\0${uid}`) ? false : { uid }
  );

  const client = {
    usable: true,
    connect: vi.fn(async () => undefined),
    logout: vi.fn(async () => true),
    close: vi.fn(),
    status,
    list: vi.fn(async () => mailboxList),
    getMailboxLock: vi.fn(async (mailbox: string) => {
      selectedMailbox = mailbox;
      return { release: vi.fn() };
    }),
    fetchOne,
    messageFlagsAdd,
    messageFlagsRemove,
    messageMove,
    messageCopy,
    mailboxCreate,
    mailboxRename,
    mailboxSubscribe,
    mailboxUnsubscribe
  } as unknown as ImapFlow;

  return {
    client,
    fetchOne,
    messageFlagsAdd,
    messageFlagsRemove,
    messageMove,
    messageCopy,
    mailboxCreate,
    mailboxRename,
    status,
    mailboxSubscribe,
    mailboxUnsubscribe
  };
}
