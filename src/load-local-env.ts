export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // 운영 환경에서는 파일 대신 환경변수를 직접 주입할 수 있음.
  }
}
