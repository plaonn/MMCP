# MMCP

IMAP을 통해 수신 이메일을 관리하는 개인용 모바일 우선 MCP 서버임.

현재 수신 이메일 조회 및 상태 관리 MVP가 구현되어 있음. 네이버 메일의 조회,
읽음·별표 상태 변경, 복사, 일반·휴지통·스팸 이동, 사용자 편지함 관리와
메일 후속 조치 ledger를 Streamable HTTP MCP 도구로 제공함.

## 요구 환경

- Node.js 24.15 이상
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

메일 관리 자연어 규칙은 기본적으로 `~/.config/mmcp/mail-policy.json`에
저장됨. 필요하면 `MMCP_POLICY_PATH`로 저장 경로를 변경함.
메일 후속 조치 ledger는 기본적으로 `~/.config/mmcp/workflow.sqlite`에
저장됨. 필요하면 `MMCP_WORKFLOW_DB_PATH`로 저장 경로를 변경함.

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
- `get_mailbox_status`: UIDVALIDITY, UIDNEXT, 메시지 수와 HIGHESTMODSEQ 조회
- `search_emails`: UID 페이지네이션과 별표·크기 조건을 지원하는 이메일 메타데이터 검색
- `get_email`: 안전한 텍스트 본문과 첨부파일 메타데이터 조회
- `get_emails`: 여러 이메일의 안전한 텍스트 본문과 첨부파일 메타데이터 조회
- `get_email_headers`: 이메일 원본 헤더 조회
- `get_email_source`: 크기 제한이 적용된 RFC822 원본 조회
- `set_emails_read_status`: 여러 이메일의 읽음 또는 읽지 않음 상태 변경
- `set_emails_flagged_status`: 여러 이메일의 별표 상태 변경
- `copy_emails`: 여러 이메일을 작업별 대상 편지함으로 복사
- `move_emails`: 여러 이메일을 작업별 안전한 대상 편지함으로 이동
- `trash_emails`: 여러 이메일을 휴지통으로 이동
- `mark_emails_as_spam`: 여러 이메일을 스팸 편지함으로 이동
- `create_mailbox`: 사용자 편지함 생성
- `rename_mailbox`: 사용자 편지함 이름 변경
- `set_mailbox_subscription`: 편지함 구독 상태 변경
- `get_mail_rules`: 최신 메일 관리 자연어 규칙 조회
- `get_bulk_operation_diagnostics`: 현재 프로세스의 최근 벌크 작업 실행 요약 조회
- `preview_mail_rules_patch`: 규칙 단위 변경 미리보기
- `apply_mail_rules_patch`: revision이 일치할 때 규칙 단위 변경 적용
- `get_mail_rules_history`: 최근 규칙 revision 조회
- `revert_mail_rules_revision`: 과거 규칙 목록을 새 revision으로 복원
- `search_mail_actions`: MMCP 내부 메일 후속 조치 상태 검색
- `get_mail_action`: 메일 후속 조치 상태 상세 및 비식별 event 이력 조회
- `get_todoist_export_candidates`: Todoist로 내보낼 후속 조치 후보 조회
- `upsert_mail_actions`: 메일 후속 조치 상태 생성 또는 갱신
- `update_mail_actions`: 메일 후속 조치 상태, 일정, tag와 sync 정보 갱신
- `record_mail_action_location`: 메일 후속 조치의 현재 편지함/UID 위치 기록
- `record_todoist_sync_results`: 외부 Todoist task ID와 sync 상태 기록

영구 삭제, 휴지통 비우기, 편지함 삭제, 메일 발송 기능은 제공하지 않음.

복수형 이메일 변경 도구는 한 호출에서 최대 100개 작업을 처리함. 작업마다
고유한 `id`, 출발 편지함, IMAP UID와 필요한 상태 또는 목적지 편지함을 지정함.
응답은 처리 개수와 작업별 `succeeded` 또는 `failed` 결과를 반환함. 일부
작업만 성공할 수 있으며 transaction과 rollback은 지원하지 않음.

`get_emails`는 서로 다른 편지함의 이메일을 한 호출에서 최대 20건 조회함.
기본적으로 이메일별 최대 2,000자와 호출 전체 최대 20,000자 범위의 본문
미리보기를 반환하고 원래 길이와 잘림 여부를 표시함. 본문과 첨부파일
메타데이터 포함 여부를 선택할 수 있으며 전체 본문은 단건 `get_email`로
조회함. 일부 조회가 실패해도 나머지 조회를 계속함.

`search_emails`는 기존 메타데이터 배열을 UID 내림차순으로 반환함. 다음
페이지는 현재 결과의 마지막 UID를 `olderThanUid`로 지정하여 조회하며, 별표
상태와 이메일 원본 크기 범위를 검색 조건으로 지정할 수 있음.

메일 후속 조치 ledger는 SQLite에 저장됨. 본문과 첨부파일 내용은 저장하지
않고, 제한된 표시용 제목/발신자 snapshot과 Message-ID, UIDVALIDITY/UID,
HMAC 기반 hash를 저장함. `MailAction.status`는 후속 조치 workflow 단계만
표현하고, 정리 lifecycle과 Todoist sync 상태는 별도 필드로 관리함.

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
