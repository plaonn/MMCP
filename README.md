# MMCP

IMAP을 통해 수신 이메일을 관리하는 개인용 모바일 우선 MCP 서버임.

현재 수신 이메일 조회 및 상태 관리 MVP가 구현되어 있음. 네이버 메일의 조회,
읽음·별표 상태 변경, 복사, 일반·휴지통·스팸 이동, 사용자 편지함 관리를
Streamable HTTP MCP 도구로 제공함.

## 요구 환경

- Node.js 22 이상
- 네이버 메일에서 활성화한 IMAP
- 네이버 2단계 인증과 애플리케이션 비밀번호

## 시작

```bash
npm install
cp .env.example .env
```

`.env`에 공개 HTTPS MCP URL, OAuth 소유자 비밀번호와 서명 비밀값, 네이버
이메일 주소 및 애플리케이션 비밀번호를 설정함. 실제 비밀값이 들어간 `.env`는
Git에서 제외됨.

네이버 연결만 안전하게 확인하려면 다음 명령을 실행함. 이메일 주소, 편지함
이름, 메일 내용은 출력하지 않음.

```bash
npm run check:imap
```

```bash
npm run build
npm start
```

기본 로컬 수신 주소는 `http://127.0.0.1:3000/mcp`임. MCP client에는
`MMCP_PUBLIC_URL`에 설정한 공개 HTTPS 주소를 등록함. 서버는 OAuth 2.1
authorization-code + PKCE 흐름과 DCR을 제공하며, 연결 승인 시
`MMCP_OAUTH_OWNER_PASSWORD`를 입력해야 함.

## MCP 도구

- `check_connection`: 네이버 IMAP 연결 확인
- `get_server_capabilities`: IMAP 서버 지원 기능 조회
- `get_quota`: 저장 용량 사용량 조회
- `list_mailboxes`: 편지함 목록 조회
- `search_emails`: 이메일 메타데이터 검색
- `get_email`: 안전한 텍스트 본문과 첨부파일 메타데이터 조회
- `get_email_headers`: 이메일 원본 헤더 조회
- `get_email_source`: 크기 제한이 적용된 RFC822 원본 조회
- `set_email_read_status`: 단일 이메일의 읽음 또는 읽지 않음 상태 변경
- `set_email_flagged_status`: 단일 이메일의 별표 상태 변경
- `copy_email`: 단일 이메일 복사
- `move_email`: 단일 이메일을 안전한 대상 편지함으로 이동
- `trash_email`: 단일 이메일을 휴지통으로 이동
- `mark_email_as_spam`: 단일 이메일을 스팸 편지함으로 이동
- `create_mailbox`: 사용자 편지함 생성
- `rename_mailbox`: 사용자 편지함 이름 변경
- `set_mailbox_subscription`: 편지함 구독 상태 변경

영구 삭제, 휴지통 비우기, 편지함 삭제, 메일 발송 기능은 제공하지 않음.

## 검증

```bash
npm run typecheck
npm test
npm run build
```

## 프로젝트 문서

- [`docs/SPEC.md`](docs/SPEC.md): 시스템이 현재 제공해야 하는 동작
- [`docs/ROADMAP.md`](docs/ROADMAP.md): 장기 계획과 예상 개발 순서
- [`work/`](work/): 현재 논의하거나 구현 중인 작업 항목
- [`docs/decisions/`](docs/decisions/): 장기간 보존할 설계 결정
- [`deploy/README.md`](deploy/README.md): HTTPS 및 macOS 자동 시작 배포 절차
- [`AGENTS.md`](AGENTS.md): 필수 개발 및 문서 관리 절차
