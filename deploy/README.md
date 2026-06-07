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

## macOS 자동 시작

`launchd` 사용자 서비스는 로그인 시 MMCP와 Caddy를 시작하고, 프로세스가
비정상 종료되면 다시 시작함. 설치 전에 수동으로 실행 중인 MMCP와 Caddy를
종료해야 함.

```bash
./deploy/install-macos-services.sh
```

설치 스크립트는 현재 저장소, Node.js, Caddy 경로로 LaunchAgent 설정을 생성하고
빌드 및 Caddy 설정 검증 후 등록함. Caddy access log와 애플리케이션 영구 log
파일은 기본적으로 생성하지 않음.

서비스 상태는 다음 명령으로 확인함.

```bash
launchctl print gui/$(id -u)/com.plaonn.mmcp
launchctl print gui/$(id -u)/com.plaonn.mmcp.caddy
```

강제 종료 또는 비정상 종료 후에는 `launchd` 재시작 간격 때문에 endpoint
복구까지 약 10초가 걸릴 수 있음.

## MCP 도구 schema 변경 반영

도구명 또는 입력 schema를 변경한 뒤 MMCP 서비스를 재시작해도 ChatGPT
앱/커넥터가 이전 schema를 캐시하여 새 도구나 입력을 차단할 수 있음.

새 schema를 사용하는 호출이 서버에 도달하기 전에 거부되면 MMCP 구현 오류로
판단하기 전에 앱/커넥터 schema를 갱신하거나 재연결함. 갱신 후 도구 목록에서
새 필드가 노출되는지 확인하고 동일 호출을 다시 검증함.

서버 측 자동 테스트와 서비스 health 확인만으로 ChatGPT가 최신 schema를
사용한다고 판단하지 않음.

서비스 제거:

```bash
./deploy/uninstall-macos-services.sh
```

## 수동 실행

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
