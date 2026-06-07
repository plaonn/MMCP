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
  flagged?: boolean;
  minSize?: number;
  maxSize?: number;
  olderThanUid?: number;
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

export type ServerCapabilities = {
  capabilities: string[];
  specialUses: string[];
  features: {
    idle: boolean;
    move: boolean;
    quota: boolean;
    sort: boolean;
    thread: boolean;
  };
};

export type QuotaResult = {
  supported: boolean;
  mailbox: string;
  storage?: {
    used: number;
    limit: number;
    percent: number;
  };
};

export type EmailHeaders = {
  mailbox: string;
  uid: number;
  headers: string;
};

export type EmailSource = {
  mailbox: string;
  uid: number;
  source: string;
};

export type FlaggedStatusResult = {
  mailbox: string;
  uid: number;
  flagged: boolean;
};

export type CopyEmailResult = {
  sourceMailbox: string;
  sourceUid: number;
  destinationMailbox: string;
  destinationUid: number | null;
};

export type MailboxCreateResult = {
  path: string;
  created: boolean;
};

export type MailboxRenameResult = {
  path: string;
  newPath: string;
};

export type MailboxSubscriptionResult = {
  path: string;
  subscribed: boolean;
};

export interface EmailReader {
  checkConnection(): Promise<{ connected: true }>;
  getServerCapabilities(): Promise<ServerCapabilities>;
  getQuota(mailbox: string): Promise<QuotaResult>;
  listMailboxes(): Promise<Mailbox[]>;
  searchEmails(input: SearchEmailsInput): Promise<EmailSummary[]>;
  getEmail(mailbox: string, uid: number): Promise<EmailDetail>;
  getEmailHeaders(mailbox: string, uid: number): Promise<EmailHeaders>;
  getEmailSource(mailbox: string, uid: number): Promise<EmailSource>;
  setEmailReadStatus(mailbox: string, uid: number, read: boolean): Promise<ReadStatusResult>;
  setEmailFlaggedStatus(
    mailbox: string,
    uid: number,
    flagged: boolean
  ): Promise<FlaggedStatusResult>;
  copyEmail(
    mailbox: string,
    uid: number,
    destinationMailbox: string
  ): Promise<CopyEmailResult>;
  moveEmail(mailbox: string, uid: number, destinationMailbox: string): Promise<MoveEmailResult>;
  trashEmail(mailbox: string, uid: number): Promise<MoveEmailResult>;
  markEmailAsSpam(mailbox: string, uid: number): Promise<MoveEmailResult>;
  createMailbox(path: string): Promise<MailboxCreateResult>;
  renameMailbox(path: string, newPath: string): Promise<MailboxRenameResult>;
  setMailboxSubscription(path: string, subscribed: boolean): Promise<MailboxSubscriptionResult>;
}
