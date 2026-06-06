import { homedir } from "node:os";
import { resolve } from "node:path";

import { z } from "zod";

const environmentSchema = z.object({
  MMCP_HOST: z.string().min(1).default("127.0.0.1"),
  MMCP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MMCP_PUBLIC_URL: z.url(),
  MMCP_OAUTH_OWNER_PASSWORD: z.string().min(16),
  MMCP_OAUTH_SIGNING_SECRET: z.string().min(32),
  MMCP_POLICY_PATH: z.string().min(1).default("~/.config/mmcp/mail-policy.json"),
  IMAP_HOST: z.string().min(1).default("imap.naver.com"),
  IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  IMAP_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  IMAP_USER: z.string().min(1),
  IMAP_PASSWORD: z.string().min(1),
  MMCP_MAX_EMAIL_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(5 * 1024 * 1024)
});

export type Config = {
  host: string;
  port: number;
  publicUrl: URL;
  oauth: {
    ownerPassword: string;
    signingSecret: string;
  };
  policyPath: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  };
  maxEmailBytes: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = environmentSchema.safeParse(environment);

  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");
    throw new Error(`필수 환경변수 설정이 올바르지 않음: ${fields}`);
  }

  return {
    host: parsed.data.MMCP_HOST,
    port: parsed.data.MMCP_PORT,
    publicUrl: new URL(parsed.data.MMCP_PUBLIC_URL),
    oauth: {
      ownerPassword: parsed.data.MMCP_OAUTH_OWNER_PASSWORD,
      signingSecret: parsed.data.MMCP_OAUTH_SIGNING_SECRET
    },
    policyPath: resolvePolicyPath(parsed.data.MMCP_POLICY_PATH),
    imap: {
      host: parsed.data.IMAP_HOST,
      port: parsed.data.IMAP_PORT,
      secure: parsed.data.IMAP_SECURE,
      user: parsed.data.IMAP_USER,
      password: parsed.data.IMAP_PASSWORD
    },
    maxEmailBytes: parsed.data.MMCP_MAX_EMAIL_BYTES
  };
}

function resolvePolicyPath(path: string): string {
  return path === "~" || path.startsWith("~/")
    ? resolve(homedir(), path.slice(2))
    : resolve(path);
}
