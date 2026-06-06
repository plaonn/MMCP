import { ImapFlow, type FetchMessageObject, type ListResponse } from "imapflow";
import { simpleParser, type AddressObject, type Attachment } from "mailparser";

import type {
  AttachmentMetadata,
  EmailDetail,
  EmailReader,
  EmailSummary,
  Mailbox,
  MoveEmailResult,
  ReadStatusResult,
  SearchEmailsInput
} from "./types.js";

export type ImapReaderOptions = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  maxEmailBytes: number;
  createClient?: () => ImapFlow;
};

export class ImapEmailReader implements EmailReader {
  constructor(private readonly options: ImapReaderOptions) {}

  async checkConnection(): Promise<{ connected: true; user: string }> {
    return this.withClient(async () => ({
      connected: true,
      user: this.options.user
    }));
  }

  async listMailboxes(): Promise<Mailbox[]> {
    return this.withClient(async (client) => {
      const mailboxes = await client.list();
      return mailboxes.map(mapMailbox);
    });
  }

  async searchEmails(input: SearchEmailsInput): Promise<EmailSummary[]> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(input.mailbox);
      try {
        const criteria = buildSearchCriteria(input);
        const matched = await client.search(criteria, { uid: true });
        if (!matched) {
          return [];
        }
        const uids = [...matched].sort((a, b) => b - a).slice(0, input.limit);

        if (uids.length === 0) {
          return [];
        }

        const results: EmailSummary[] = [];
        for await (const message of client.fetch(
          uids,
          {
            uid: true,
            envelope: true,
            flags: true,
            size: true,
            bodyStructure: true
          },
          { uid: true }
        )) {
          results.push(mapSummary(input.mailbox, message));
        }

        return results.sort((a, b) => b.uid - a.uid);
      } finally {
        lock.release();
      }
    });
  }

  async getEmail(mailbox: string, uid: number): Promise<EmailDetail> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const metadata = await client.fetchOne(
          uid,
          {
            uid: true,
            envelope: true,
            flags: true,
            size: true,
            bodyStructure: true
          },
          { uid: true }
        );

        if (!metadata) {
          throw new Error("요청한 이메일을 찾을 수 없음");
        }
        if ((metadata.size ?? 0) > this.options.maxEmailBytes) {
          throw new Error(
            `이메일 크기가 조회 제한(${this.options.maxEmailBytes} bytes)을 초과함`
          );
        }

        const sourceMessage = await client.fetchOne(
          uid,
          { source: true },
          { uid: true }
        );
        if (!sourceMessage || !sourceMessage.source) {
          throw new Error("이메일 본문을 가져올 수 없음");
        }
        if (sourceMessage.source.length > this.options.maxEmailBytes) {
          throw new Error(
            `이메일 크기가 조회 제한(${this.options.maxEmailBytes} bytes)을 초과함`
          );
        }

        const parsed = await simpleParser(sourceMessage.source, {
          skipImageLinks: true,
          skipTextLinks: true,
          maxHtmlLengthToParse: this.options.maxEmailBytes
        });
        const summary = mapSummary(mailbox, metadata);

        return {
          ...summary,
          cc: addressObjectToStrings(parsed.cc),
          replyTo: addressObjectToStrings(parsed.replyTo),
          text: normalizeText(parsed.text ?? ""),
          attachments: parsed.attachments.map(mapAttachment)
        };
      } finally {
        lock.release();
      }
    });
  }

  async setEmailReadStatus(
    mailbox: string,
    uid: number,
    read: boolean
  ): Promise<ReadStatusResult> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(mailbox);
      try {
        await assertMessageExists(client, uid);
        const changed = read
          ? await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true })
          : await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });

        if (!changed) {
          throw new Error("이메일 읽음 상태를 변경할 수 없음");
        }

        return { mailbox, uid, read };
      } finally {
        lock.release();
      }
    });
  }

  async moveEmail(
    mailbox: string,
    uid: number,
    destinationMailbox: string
  ): Promise<MoveEmailResult> {
    return this.withClient(async (client) => {
      return this.moveEmailWithClient(client, mailbox, uid, destinationMailbox);
    });
  }

  private async moveEmailWithClient(
    client: ImapFlow,
    mailbox: string,
    uid: number,
    destinationMailbox: string
  ): Promise<MoveEmailResult> {
    if (mailbox === destinationMailbox) {
      throw new Error("같은 편지함으로 이동할 수 없음");
    }

    const destination = (await client.list()).find(
      (candidate) => candidate.path === destinationMailbox
    );
    if (!destination) {
      throw new Error("대상 편지함을 찾을 수 없음");
    }
    if (destination.specialUse === "\\Trash") {
      throw new Error("휴지통으로 이동할 수 없음");
    }

    const lock = await client.getMailboxLock(mailbox);
    try {
      await assertMessageExists(client, uid);
      const moved = await client.messageMove(uid, destinationMailbox, { uid: true });
      if (!moved) {
        throw new Error("이메일을 이동할 수 없음");
      }

      return {
        sourceMailbox: mailbox,
        sourceUid: uid,
        destinationMailbox,
        destinationUid: moved.uidMap?.get(uid) ?? null
      };
    } finally {
      lock.release();
    }
  }

  private async withClient<T>(operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client =
      this.options.createClient?.() ??
      new ImapFlow({
        host: this.options.host,
        port: this.options.port,
        secure: this.options.secure,
        auth: {
          user: this.options.user,
          pass: this.options.password
        },
        logger: false
      });

    try {
      await client.connect();
      return await operation(client);
    } finally {
      if (client.usable) {
        await client.logout().catch(() => undefined);
      } else {
        client.close();
      }
    }
  }
}

async function assertMessageExists(client: ImapFlow, uid: number): Promise<void> {
  const message = await client.fetchOne(uid, { uid: true }, { uid: true });
  if (!message) {
    throw new Error("요청한 이메일을 찾을 수 없음");
  }
}

function buildSearchCriteria(input: SearchEmailsInput): Record<string, unknown> {
  const criteria: Record<string, unknown> = {};

  if (input.text) criteria.body = input.text;
  if (input.from) criteria.from = input.from;
  if (input.to) criteria.to = input.to;
  if (input.subject) criteria.subject = input.subject;
  if (input.since) criteria.since = new Date(input.since);
  if (input.before) criteria.before = new Date(input.before);
  if (input.unread !== undefined) criteria.seen = !input.unread;

  return Object.keys(criteria).length > 0 ? criteria : { all: true };
}

function mapMailbox(mailbox: ListResponse): Mailbox {
  return {
    path: mailbox.path,
    name: mailbox.name,
    specialUse: mailbox.specialUse ?? null,
    subscribed: mailbox.subscribed
  };
}

function mapSummary(mailbox: string, message: FetchMessageObject): EmailSummary {
  return {
    mailbox,
    uid: message.uid,
    messageId: message.envelope?.messageId ?? null,
    subject: message.envelope?.subject ?? null,
    from: addressesToStrings(message.envelope?.from),
    to: addressesToStrings(message.envelope?.to),
    date: formatDate(message.envelope?.date),
    size: message.size ?? 0,
    flags: [...(message.flags ?? [])].sort(),
    hasAttachments: bodyStructureHasAttachment(message.bodyStructure)
  };
}

function addressesToStrings(
  addresses:
    | Array<{ name?: string; address?: string }>
    | undefined
): string[] {
  return (addresses ?? []).map(({ name, address }) =>
    name && address ? `${name} <${address}>` : (address ?? name ?? "")
  ).filter(Boolean);
}

function addressObjectToStrings(
  address: AddressObject | AddressObject[] | undefined
): string[] {
  const objects = address ? (Array.isArray(address) ? address : [address]) : [];
  return objects.flatMap((object) =>
    object.value.map(({ name, address: email }) =>
      name && email ? `${name} <${email}>` : (email ?? name ?? "")
    )
  ).filter(Boolean);
}

function bodyStructureHasAttachment(
  part: FetchMessageObject["bodyStructure"]
): boolean {
  if (!part) return false;
  if (part.disposition === "attachment") return true;
  return (part.childNodes ?? []).some(bodyStructureHasAttachment);
}

function mapAttachment(attachment: Attachment): AttachmentMetadata {
  return {
    filename: attachment.filename ?? null,
    contentType: attachment.contentType,
    size: attachment.size,
    disposition: attachment.contentDisposition ?? null
  };
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function formatDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
