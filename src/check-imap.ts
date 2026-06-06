import { loadConfig } from "./config.js";
import { ImapEmailReader } from "./email/imap-reader.js";
import { loadLocalEnv } from "./load-local-env.js";

try {
  loadLocalEnv();
  const config = loadConfig();
  const emailReader = new ImapEmailReader({
    ...config.imap,
    maxEmailBytes: config.maxEmailBytes
  });

  await emailReader.checkConnection();
  const mailboxes = await emailReader.listMailboxes();
  console.log(`네이버 IMAP 연결 성공. 조회 가능한 편지함: ${mailboxes.length}개`);
} catch {
  console.error("네이버 IMAP 연결 실패. .env와 네이버 IMAP 설정을 확인해야 함.");
  process.exitCode = 1;
}
