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
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.trashEmail("INBOX", 42)).resolves.toMatchObject({
      destinationMailbox: "Trash"
    });
    await expect(reader.markEmailAsSpam("INBOX", 42)).resolves.toMatchObject({
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
  const messageFlagsAdd = vi.fn(async () => true);
  const messageFlagsRemove = vi.fn(async () => true);
  const messageMove = vi.fn(async (_uid: number, destination: string) => ({
    path: "INBOX",
    destination,
    uidMap: new Map([[42, 84]])
  }));
  const messageCopy = vi.fn(async (_uid: number, destination: string) => ({
    path: "INBOX",
    destination,
    uidMap: new Map([[42, 84]])
  }));
  const mailboxCreate = vi.fn(async (path: string) => ({ path, created: true }));
  const mailboxRename = vi.fn(async (path: string, newPath: string) => ({ path, newPath }));
  const mailboxSubscribe = vi.fn(async () => true);
  const mailboxUnsubscribe = vi.fn(async () => true);

  const client = {
    usable: true,
    connect: vi.fn(async () => undefined),
    logout: vi.fn(async () => true),
    close: vi.fn(),
    list: vi.fn(async () => mailboxList),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    fetchOne: vi.fn(async () => ({ uid: 42 })),
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
    messageFlagsAdd,
    messageFlagsRemove,
    messageMove,
    messageCopy,
    mailboxCreate,
    mailboxRename,
    mailboxSubscribe,
    mailboxUnsubscribe
  };
}
