import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  AccessDeniedError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";

const supportedScopes = new Set(["mail.read", "mail.modify"]);
const authorizationCodeLifetimeMs = 5 * 60 * 1000;
const accessTokenLifetimeSeconds = 60 * 60;
const refreshTokenLifetimeSeconds = 30 * 24 * 60 * 60;

type AuthorizationCode = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
};

type SignedAccessToken = {
  type: "access";
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
};

type SignedRefreshToken = {
  type: "refresh";
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
};

export class PersonalOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  readonly skipLocalPkceValidation = false;

  private readonly authorizationCodes = new Map<string, AuthorizationCode>();

  constructor(
    private readonly options: {
      ownerPassword: string;
      signingSecret: string;
      resourceUrl: URL;
    }
  ) {
    this.clientsStore = {
      getClient: (clientId) => this.readClient(clientId),
      registerClient: (client) => this.registerClient(client)
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    response: Response
  ): Promise<void> {
    this.validateScopes(params.scopes ?? []);
    this.validateResource(params.resource);

    const request = response.req;
    if (request.method === "GET") {
      response.status(200).type("html").send(renderAuthorizationPage(client, params));
      return;
    }

    if (!safeEqual(String(request.body?.owner_password ?? ""), this.options.ownerPassword)) {
      throw new AccessDeniedError("소유자 비밀번호가 올바르지 않음");
    }

    const code = randomBytes(32).toString("base64url");
    this.authorizationCodes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      resource: this.options.resourceUrl.href,
      scopes: params.scopes ?? [],
      expiresAt: Date.now() + authorizationCodeLifetimeMs
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set("code", code);
    if (params.state) {
      redirect.searchParams.set("state", params.state);
    }
    response.redirect(302, redirect.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    return this.getAuthorizationCode(client, authorizationCode).codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const grant = this.getAuthorizationCode(client, authorizationCode);
    this.authorizationCodes.delete(authorizationCode);

    if (redirectUri !== grant.redirectUri) {
      throw new InvalidGrantError("redirect_uri가 인가 요청과 일치하지 않음");
    }
    if (resource?.href !== grant.resource) {
      throw new InvalidTargetError("resource가 인가 요청과 일치하지 않음");
    }

    return this.issueTokens(client.client_id, grant.scopes, grant.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const payload = this.verifySignedValue<SignedRefreshToken>(refreshToken);
    if (
      !payload ||
      payload.type !== "refresh" ||
      payload.clientId !== client.client_id ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new InvalidGrantError("refresh token이 올바르지 않거나 만료됨");
    }
    if (resource?.href !== payload.resource) {
      throw new InvalidTargetError("resource가 refresh token과 일치하지 않음");
    }

    const requestedScopes = scopes ?? payload.scopes;
    this.validateScopes(requestedScopes);
    if (requestedScopes.some((scope) => !payload.scopes.includes(scope))) {
      throw new InvalidScopeError("기존 승인 범위를 초과하는 scope를 요청할 수 없음");
    }

    return this.issueTokens(client.client_id, requestedScopes, payload.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.verifySignedValue<SignedAccessToken>(token);
    if (
      !payload ||
      payload.type !== "access" ||
      payload.resource !== this.options.resourceUrl.href ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new InvalidTokenError("Access token is invalid or expired");
    }
    this.validateScopes(payload.scopes);

    return {
      token,
      clientId: payload.clientId,
      scopes: payload.scopes,
      expiresAt: payload.expiresAt,
      resource: this.options.resourceUrl
    };
  }

  private registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): OAuthClientInformationFull {
    if (client.token_endpoint_auth_method !== "none") {
      throw new InvalidClientMetadataError("public client의 token_endpoint_auth_method는 none이어야 함");
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const registered = {
      ...client,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_id_issued_at: issuedAt
    };

    return {
      ...registered,
      client_id: this.signValue(registered)
    };
  }

  private readClient(clientId: string): OAuthClientInformationFull | undefined {
    const client = this.verifySignedValue<OAuthClientInformationFull>(clientId);
    if (!client || !Array.isArray(client.redirect_uris)) {
      return undefined;
    }
    return { ...client, client_id: clientId };
  }

  private getAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): AuthorizationCode {
    const grant = this.authorizationCodes.get(authorizationCode);
    if (!grant || grant.clientId !== client.client_id || grant.expiresAt <= Date.now()) {
      this.authorizationCodes.delete(authorizationCode);
      throw new InvalidGrantError("인가 코드가 올바르지 않거나 만료됨");
    }
    return grant;
  }

  private issueTokens(clientId: string, scopes: string[], resource: string): OAuthTokens {
    const expiresAt = Math.floor(Date.now() / 1000) + accessTokenLifetimeSeconds;
    const refreshExpiresAt = Math.floor(Date.now() / 1000) + refreshTokenLifetimeSeconds;
    return {
      access_token: this.signValue({
        type: "access",
        clientId,
        scopes,
        resource,
        expiresAt
      } satisfies SignedAccessToken),
      token_type: "Bearer",
      expires_in: accessTokenLifetimeSeconds,
      scope: scopes.join(" "),
      refresh_token: this.signValue({
        type: "refresh",
        clientId,
        scopes,
        resource,
        expiresAt: refreshExpiresAt
      } satisfies SignedRefreshToken)
    };
  }

  private validateScopes(scopes: string[]): void {
    if (scopes.length === 0 || scopes.some((scope) => !supportedScopes.has(scope))) {
      throw new InvalidScopeError("지원하는 scope는 mail.read와 mail.modify임");
    }
  }

  private validateResource(resource?: URL): void {
    if (resource?.href !== this.options.resourceUrl.href) {
      throw new InvalidTargetError("올바른 MCP resource가 필요함");
    }
  }

  private signValue(value: unknown): string {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signature = createHmac("sha256", this.options.signingSecret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  private verifySignedValue<T>(value: string): T | undefined {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) {
      return undefined;
    }

    const expected = createHmac("sha256", this.options.signingSecret)
      .update(payload)
      .digest("base64url");
    if (!safeEqual(signature, expected)) {
      return undefined;
    }

    try {
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
    } catch {
      return undefined;
    }
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function renderAuthorizationPage(
  client: OAuthClientInformationFull,
  params: AuthorizationParams
): string {
  const fields = {
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    response_type: "code",
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    scope: (params.scopes ?? []).join(" "),
    state: params.state,
    resource: params.resource?.href
  };
  const hiddenFields = Object.entries(fields)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("");

  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MMCP 연결 승인</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#171717}label{display:block;margin:1.5rem 0 .5rem}input,button{box-sizing:border-box;width:100%;padding:.75rem;font:inherit}button{margin-top:1rem;background:#171717;color:#fff;border:0;cursor:pointer}.scope{padding:.75rem;background:#f3f4f6}</style></head>
<body><h1>MMCP 연결 승인</h1><p>${escapeHtml(client.client_name ?? "OAuth client")}에서 개인 메일 접근을 요청함.</p>
<p class="scope">요청 권한: ${escapeHtml((params.scopes ?? []).join(", "))}</p>
<form method="post" action="/authorize">${hiddenFields}<label for="owner_password">소유자 비밀번호</label><input id="owner_password" name="owner_password" type="password" required autocomplete="current-password"><button type="submit">연결 승인</button></form></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
