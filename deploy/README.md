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

## 현재 checkout 업데이트

코드나 MCP schema를 변경한 뒤에는 다음 스크립트로 현재 checkout을 검증하고
실행 중인 MMCP에 반영함.

```bash
./deploy/update-macos-service.sh
```

스크립트는 다음 순서로 실행함.

1. MMCP launchd service가 설치되어 있는지 확인함.
2. Caddy 설정을 검증함.
3. typecheck, 전체 자동 테스트와 build를 실행함.
4. MMCP launchd service를 재시작함.
5. local health endpoint를 최대 15초 동안 재시도함.

검증이나 build가 실패하면 실행 중인 서비스를 재시작하지 않음. health 확인이
실패하면 `launchctl print` 상태를 출력하고 실패함. schema 변경 후에는 아래
절차에 따라 ChatGPT connector schema도 별도로 갱신함.

환경에 따라 health 재시도 횟수와 URL을 변경할 수 있음.

```bash
MMCP_HEALTH_ATTEMPTS=30 ./deploy/update-macos-service.sh
MMCP_HEALTH_URL=http://127.0.0.1:3000/health ./deploy/update-macos-service.sh
```

### 업데이트 실패 복구

1. `launchctl print gui/$(id -u)/com.plaonn.mmcp`와 local health를 확인함.
2. 검증 또는 build 단계 실패면 코드를 수정한 뒤 업데이트 스크립트를 다시
   실행함. 기존 서비스는 계속 실행 중임.
3. 재시작 후 실패면 마지막 정상 commit을 checkout하고 업데이트 스크립트를
   다시 실행함.
4. DB schema 변경을 포함한 commit을 되돌려야 하면 먼저 MMCP service를
   `bootout`하고 아래 backup에서 workflow DB를 복원한 뒤 LaunchAgent를 다시
   설치함.

## MCP 도구 schema 변경 반영

도구명 또는 입력 schema를 변경한 뒤 MMCP 서비스를 재시작해도 ChatGPT
앱/커넥터가 이전 schema를 캐시하여 새 도구나 입력을 차단할 수 있음.

새 schema를 사용하는 호출이 서버에 도달하기 전에 거부되면 MMCP 구현 오류로
판단하기 전에 앱/커넥터 schema를 갱신하거나 재연결함. 갱신 후 도구 목록에서
새 필드가 노출되는지 확인하고 동일 호출을 다시 검증함.

서버 측 자동 테스트와 서비스 health 확인만으로 ChatGPT가 최신 schema를
사용한다고 판단하지 않음.

## 운영 상태 점검

다음 스크립트는 비밀값과 이메일 내용을 출력하지 않고 MMCP/Caddy service
상태, PID, uptime, CPU, RSS, local health, Caddy config와 운영 디렉터리 크기를
확인함.

```bash
./deploy/check-macos-services.sh
```

장기 안정성 관찰 중에는 매일 또는 장애 직후 실행 결과에서 다음만 기록함.

- 실행 시각
- service state와 PID 변경 여부
- uptime, CPU와 RSS
- local health 성공 여부
- `dist`, `~/.config/mmcp` 디렉터리 크기
- 절전, 재부팅, 네트워크 단절 또는 인증서 갱신 같은 관찰 상황

출력에 개인 데이터나 비밀값을 추가하지 않음.

## 비밀값과 상태 backup

backup에는 `.env`, 메일 관리 규칙과 workflow SQLite DB가 포함됨. backup
디렉터리는 source control과 일반 공유 디렉터리 밖에 두고 `0700`, 파일은
`0600` 이하 권한으로 관리함. `.env`에는 IMAP application password, OAuth
소유자 비밀번호와 signing secret이 포함되므로 평문 외부 전송을 금지함.

실행 중인 SQLite DB는 파일 복사 대신 `sqlite3 .backup`을 사용함.

```bash
umask 077
backup_dir="$HOME/mmcp-backup/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp .env "$backup_dir/mmcp.env"
cp "$HOME/.config/mmcp/mail-policy.json" "$backup_dir/mail-policy.json"
sqlite3 "$HOME/.config/mmcp/workflow.sqlite" ".backup '$backup_dir/workflow.sqlite'"
```

복원 전에 현재 파일도 별도 backup하고 MMCP service를 중지함.

```bash
launchctl bootout "gui/$(id -u)/com.plaonn.mmcp"
cp "$backup_dir/mmcp.env" .env
cp "$backup_dir/mail-policy.json" "$HOME/.config/mmcp/mail-policy.json"
cp "$backup_dir/workflow.sqlite" "$HOME/.config/mmcp/workflow.sqlite"
chmod 600 .env "$HOME/.config/mmcp/mail-policy.json" "$HOME/.config/mmcp/workflow.sqlite"
./deploy/install-macos-services.sh
```

복원 후 local health와 ChatGPT 연결을 확인함. OAuth signing secret이 backup과
다르면 기존 access token과 client ID를 계속 검증할 수 없으므로 다시 연결해야
함.

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
