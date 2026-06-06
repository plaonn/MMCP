export type Mailbox = {
  path: string;
  name: string;
  specialUse: string | null;
  subscribed: boolean;
};

export type EmailSummary = {
  mailbox: string;
  uid: number;
  messageId: string | null;
  subject: string | null;
  from: string[];
  to: string[];
  date: string | null;
  size: number;
  flags: string[];
  hasAttachments: boolean;
};

export type AttachmentMetadata = {
  filename: string | null;
  contentType: string;
  size: number;
  disposition: string | null;
};

export type EmailDetail = EmailSummary & {
  cc: string[];
  replyTo: string[];
  text: string;
  attachments: AttachmentMetadata[];
};

export type SearchEmailsInput = {
  mailbox: string;
  text?: string;
  from?: string;
  to?: string;
  subject?: string;
  since?: string;
  before?: string;
  unread?: boolean;
  limit: number;
};

export type ReadStatusResult = {
  mailbox: string;
  uid: number;
  read: boolean;
};

export type MoveEmailResult = {
  sourceMailbox: string;
  sourceUid: number;
  destinationMailbox: string;
  destinationUid: number | null;
};

export interface EmailReader {
  checkConnection(): Promise<{ connected: true; user: string }>;
  listMailboxes(): Promise<Mailbox[]>;
  searchEmails(input: SearchEmailsInput): Promise<EmailSummary[]>;
  getEmail(mailbox: string, uid: number): Promise<EmailDetail>;
  setEmailReadStatus(mailbox: string, uid: number, read: boolean): Promise<ReadStatusResult>;
  moveEmail(mailbox: string, uid: number, destinationMailbox: string): Promise<MoveEmailResult>;
}
