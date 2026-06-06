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
    path: "Archive",
    name: "Archive",
    specialUse: "\\Archive",
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

  it("Archive 특수 편지함으로 보관함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await reader.archiveEmail("INBOX", 42);

    expect(fake.messageMove).toHaveBeenCalledWith(42, "Archive", { uid: true });
  });

  it("Archive 특수 편지함을 하나로 결정할 수 없으면 보관을 거부함", async () => {
    const missing = createFakeClient(
      mailboxes.filter((mailbox) => mailbox.specialUse !== "\\Archive")
    );
    const duplicate = createFakeClient([
      ...mailboxes,
      {
        path: "OtherArchive",
        name: "OtherArchive",
        specialUse: "\\Archive",
        subscribed: true
      }
    ]);

    await expect(createReader(missing.client).archiveEmail("INBOX", 42)).rejects.toThrow(
      "보관 편지함을 하나로 결정할 수 없음"
    );
    await expect(createReader(duplicate.client).archiveEmail("INBOX", 42)).rejects.toThrow(
      "보관 편지함을 하나로 결정할 수 없음"
    );
  });

  it("휴지통, 같은 편지함, 존재하지 않는 편지함으로 이동을 거부함", async () => {
    const fake = createFakeClient();
    const reader = createReader(fake.client);

    await expect(reader.moveEmail("INBOX", 42, "Trash")).rejects.toThrow(
      "휴지통으로 이동할 수 없음"
    );
    await expect(reader.moveEmail("INBOX", 42, "INBOX")).rejects.toThrow(
      "같은 편지함으로 이동할 수 없음"
    );
    await expect(reader.moveEmail("INBOX", 42, "Missing")).rejects.toThrow(
      "대상 편지함을 찾을 수 없음"
    );
    expect(fake.messageMove).not.toHaveBeenCalled();
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
    messageMove
  } as unknown as ImapFlow;

  return { client, messageFlagsAdd, messageFlagsRemove, messageMove };
}
