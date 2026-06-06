# HTTPS 배포

## 네트워크 구성

```text
ChatGPT
  -> https://mac.plaonn.com/mcp
공유기 외부 TCP 443
  -> 192.168.0.80:8443
Caddy
  -> 127.0.0.1:3000
MMCP
```

공유기에서 외부 TCP `443`을 Mac의 `192.168.0.80:8443`으로 포트포워딩함.
외부 `80` 포트는 사용하지 않음.

Caddy는 외부 `mac.plaonn.com` 요청만 받은 뒤 upstream `Host`를
`127.0.0.1`로 변경함. MMCP는 localhost DNS rebinding 보호를 유지함.

## Caddy 실행

저장소 루트에서 다음 명령으로 설정을 검증함.

```bash
caddy validate --config deploy/Caddyfile --adapter caddyfile
```

MMCP와 Caddy를 각각 별도 terminal에서 실행함.

```bash
npm run build
npm start
```

```bash
caddy run --config deploy/Caddyfile --adapter caddyfile
```

최초 인증서 발급과 자동 갱신에는 외부 TCP `443` 포트포워딩이 정상 동작해야
함. Caddy는 Let's Encrypt TLS-ALPN-01 challenge를 사용하며 HTTP-01 challenge와
HTTP redirect는 비활성화함.
