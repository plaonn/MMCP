import { createApp } from "./app.js";
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
  const app = createApp(config, emailReader);

  app.listen(config.port, config.host, () => {
    console.log(`MMCP 서버 실행 중: http://${config.host}:${config.port}/mcp`);
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "알 수 없는 시작 오류";
  console.error(message);
  process.exitCode = 1;
}
