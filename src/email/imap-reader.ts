import { ImapFlow, type FetchMessageObject, type ListResponse } from "imapflow";
import { simpleParser, type AddressObject, type Attachment } from "mailparser";

import type {
  AttachmentMetadata,
  EmailDetail,
  EmailReader,
  EmailSummary,
  Mailbox,
  SearchEmailsInput
} from "./types.js";

type ImapReaderOptions = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  maxEmailBytes: number;
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

  private async withClient<T>(operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
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
    date: message.envelope?.date?.toISOString() ?? null,
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
