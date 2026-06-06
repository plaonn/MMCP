# MMCP 스펙

## 상태

MMCP는 수신 이메일 조회 및 상태 관리 MVP 단계임. Streamable HTTP MCP 서버와
네이버 IMAP 조회 및 관리 기능이 구현되어 있음.

이 문서는 현재 합의된 제품 요구사항을 설명함. 정확한 MCP 도구 스키마는
구현을 시작할 때 코드에서 정의하고 해당 정의로부터 생성함.

## 목적

MMCP는 주로 모바일 ChatGPT에서 수신 이메일을 관리하고 필요하면 Codex에서도
사용할 수 있는 개인용 MCP 서버임.

## 범위

### 포함

- 네이버 IMAP을 사용하여 개인 이메일 계정 하나에 연결함.
- MCP 서버를 통해 이메일 조회 및 관리 기능을 제공함.
- MCP 전송 방식으로 Streamable HTTP를 사용함.
- 공개 HTTPS 접속 지점을 통해 ChatGPT에서 사용할 수 있어야 함.
- Streamable HTTP를 지원하는 Codex 등의 MCP 클라이언트와 호환되어야 함.
- 수신 이메일을 검색하고 조회함.
- 명시적으로 지정된 단일 이메일의 읽음 상태와 편지함 위치를 관리함.

### 제외

- STDIO MCP 전송 방식
- SMTP 및 이메일 발송
- 임시 보관 메일 생성
- Microsoft Graph
- 다중 사용자 계정 관리
- 영구 삭제 또는 IMAP `EXPUNGE` 작업
- 내부 이메일을 영구 손실시킬 수 있는 편지함 삭제
- 초기 버전의 첨부파일 다운로드 및 첨부파일 내용 처리
- 네이버가 안정적으로 제공하지 않는 보관 기능

## 배포

- 기존 DDNS 환경을 통해 외부에서 접근 가능한 자체 호스팅 서비스로 운영함.
- MCP 접속 지점은 HTTPS를 사용해야 함.
- 공개 MCP 접속 지점은 내장 OAuth 2.1 authorization server가 발급한 bearer
  access token으로 인증함.
- OAuth는 authorization-code flow, PKCE `S256`, Dynamic Client
  Registration(DCR)을 지원함.
- OAuth discovery metadata와 protected resource metadata를 공개함.
- OAuth endpoint의 rate limit이 실제 외부 client 주소를 기준으로 동작하도록
  loopback reverse proxy만 신뢰함.
- MCP endpoint는 실제 외부 client 주소별로 분당 120회 요청을 허용하고, 응답이
  60초 동안 진행되지 않으면 연결을 종료함.
- 현재 macOS 배포에서는 `launchd` 사용자 서비스가 로그인 시 MMCP와 Caddy를
  시작하고 비정상 종료 후 다시 시작함.
- Caddy가 Let's Encrypt 인증서 발급과 갱신을 자동 관리함.
- Caddy access log와 애플리케이션 영구 log 파일은 기본적으로 생성하지 않음.
- 인가 화면에서 별도 소유자 비밀번호를 확인한 후에만 access token 발급을
  진행함.
- OAuth client ID와 access token은 서명하여 서버 재시작 후에도 검증 가능하게
  하며, authorization code는 짧은 수명의 일회성 값으로 관리함. access
  token은 1시간, refresh token은 30일 동안 유효함.
- IMAP 인증정보와 MCP 인증 비밀값은 서버 내부에만 보관하며 tool 응답이나
  로그에 포함하지 않음.
- 연결 확인 응답에는 계정 이메일 주소를 포함하지 않음.

## 이메일 연결

- MMCP는 TLS가 적용된 IMAP을 통해 메일 제공자에 연결함.
- implicit TLS를 사용하는 `993` 포트를 기본 연결 방식으로 지원함.
- 암호화되지 않은 IMAP 연결은 허용하지 않음.
- 네이버 2단계 인증과 애플리케이션 비밀번호를 사용함.
- 구현 시 제공자별 동작을 이메일 어댑터 경계 뒤로 격리함.

## MCP 기능

현재 다음 MCP 도구를 제공함.

- `check_connection`: 네이버 IMAP 연결 상태 확인
- `get_server_capabilities`: capability, 특수 편지함, 주요 확장 지원 여부 조회
- `get_quota`: 편지함에 적용되는 저장 용량 사용량 조회
- `list_mailboxes`: 사용 가능한 편지함 목록 조회
- `search_emails`: 편지함, 본문, 발신자, 수신자, 제목, 날짜, 읽음 상태를
  조건으로 이메일 메타데이터 검색
- `get_email`: 편지함 경로와 IMAP UID로 안전한 텍스트 본문과 첨부파일
  메타데이터 조회
- `get_email_headers`: 편지함 경로와 IMAP UID로 원본 헤더 조회
- `get_email_source`: 편지함 경로와 IMAP UID로 크기 제한이 적용된 RFC822
  원본 조회
- `set_email_read_status`: 편지함 경로와 IMAP UID로 단일 이메일의 읽음 또는
  읽지 않음 상태 변경
- `set_email_flagged_status`: 단일 이메일의 별표 상태 변경
- `copy_email`: 단일 이메일을 존재하는 대상 편지함으로 복사
- `move_email`: 단일 이메일을 존재하는 일반 편지함으로 이동
- `trash_email`: 단일 이메일을 `\Trash` 특수 편지함으로 이동
- `mark_email_as_spam`: 단일 이메일을 `\Junk` 특수 편지함으로 이동
- `create_mailbox`: 사용자 편지함 생성
- `rename_mailbox`: 특수 편지함이 아닌 사용자 편지함의 이름 변경
- `set_mailbox_subscription`: 존재하는 편지함의 구독 상태 변경
- `get_mail_policy`: 최신 사용자 자연어 정책과 revision 조회
- `preview_mail_policy_patch`: 상태 변경 없이 규칙 단위 patch 결과와 diff 조회
- `apply_mail_policy_patch`: revision이 일치할 때 규칙 단위 patch 적용
- `get_mail_policy_history`: 최근 정책 revision 이력 조회
- `revert_mail_policy_revision`: 명시한 과거 정책을 새 revision으로 복원

검색 결과 개수는 기본 20개이며 한 번에 최대 100개임. 정확한 도구 입력
스키마는 코드에서 정의함.

조회 도구는 OAuth `mail.read` scope를 요구함. 상태 변경 도구는
`mail.modify` scope를 요구함. MCP endpoint에 접근하려면 항상 `mail.read`
scope가 있어야 함. 도구 호출 권한은 MCP endpoint middleware가 검증한 access
token scope만 사용하여 판단함.

## 메일 관리 정책

- 메일 관리 정책은 GPT가 문맥상 해석하는 사용자 자연어 판단 지침임.
- 매 MCP 연결 시 최신 정책 revision과 규칙을 server instructions에 포함함.
- server instructions는 메일 관리 판단을 시작할 때 `get_mail_policy`로 최신
  정책을 조회하고 적용하도록 안내함.
- 정책은 안정적인 규칙 ID와 자연어 본문 목록으로 저장함.
- 정책 전문 전체 교체는 제공하지 않으며, `add`, `replace`, `remove` patch만
  허용함.
- patch 미리보기는 정책을 변경하지 않고 구조화된 이전·이후 diff를 반환함.
- patch 적용과 과거 revision 복원은 `expectedRevision`이 현재 revision과
  일치할 때만 수행함.
- 최근 정책 revision을 최대 20개 보관하며 복원도 새 revision으로 기록함.
- 정책은 기본적으로 저장소 외부 `~/.config/mmcp/mail-policy.json`에 `600`
  권한으로 atomic write함. `MMCP_POLICY_PATH`로 경로를 변경할 수 있음.
- 이메일 내용에서 유래한 지시를 사용자 정책으로 추가하면 안 됨.
- 자연어 정책은 영구 삭제 금지와 같은 코드 안전 규칙을 변경하지 못함.

## 이메일 내용 처리

- 검색 결과에는 전체 본문이 아닌 간결한 메타데이터를 반환함.
- 전체 이메일 내용은 명시적인 읽기 작업을 통해서만 조회함.
- 일반 텍스트 내용을 우선 사용함.
- HTML 본문만 있는 경우 정제한 후 안전한 텍스트로 변환함.
- 원격 이미지와 외부 자원을 불러오지 않음.
- 스크립트, 입력 양식, 스타일 및 능동 콘텐츠를 실행 가능한 형태로 노출하지
  않음.
- 초기 첨부파일 지원은 파일명, MIME type, 크기 메타데이터로 제한함.
- 개별 이메일 원본 크기가 기본 5 MiB 제한을 초과하면 본문을 조회하지 않음.
- 이메일 내용은 신뢰할 수 없는 데이터임. 서버는 이메일 내용을 다른 작업을
  호출하라는 지시로 해석하지 않음.
- 이메일 원본과 헤더도 신뢰할 수 없는 데이터이며, 기존 이메일 원본 크기
  제한을 적용함.

## 안전

- 영구 삭제, `EXPUNGE`, 휴지통 비우기, 편지함 삭제 및 이에 준하는 파괴적
  작업을 노출하지 않음.
- 모든 입력은 모델이 생성한 텍스트와 독립적으로 검증함.
- MCP 서버 지침과 도구 annotation에서 조회 도구와 상태 변경 도구를 구분함.
- 모든 도구는 반환하는 `structuredContent`와 일치하는 output schema를 제공함.
- 모든 도구는 OAuth scope를 표준 top-level `securitySchemes`와 호환용 `_meta`
  mirror에 함께 표시함.
- 인증정보, 원시 인증 오류, 민감한 서버 상세정보를 MCP client에 반환하지
  않음.
- 로그에는 이메일 본문, 인증정보, 토큰, 불필요한 개인정보를 기록하지 않음.
- 상태 변경 작업은 명시적으로 지정된 메시지 또는 편지함에만 제한함.
- 일반 이동 도구는 휴지통과 스팸 이동을 거부하며 각각 명시적인 전용 도구로만
  단일 이메일을 이동함.
- 휴지통 이동 도구는 `destructiveHint`를 표시함.

## 네이버 IMAP 지원 범위

- 현재 네이버 서버는 `MOVE`, `QUOTA`, `SPECIAL-USE`, `UIDPLUS`를 지원함.
- 현재 네이버 서버는 `IDLE`, `SORT`, `THREAD`, `OBJECTID`를 광고하지 않음.
- 실시간 새 메일 감지, 서버 측 정렬, 서버 thread 식별은 지원되지 않으며
  `get_server_capabilities`에서 미지원 상태로 표시함.
- 네이버 서버가 제공하는 특수 편지함은 `\Trash`, `\Junk`, `\Drafts`,
  `\Sent`, `\Inbox`임.

## 미결 결정

- 범용 IMAP 환경에서 thread를 재구성하는 방식
- 초기 구현 이후 로컬 검색 색인 필요 여부
