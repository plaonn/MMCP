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
- 명시적으로 지정된 여러 이메일의 읽음 상태와 편지함 위치를 한 호출에서
  관리함.
- 메일 후속 조치 상태를 내부 SQLite ledger에 저장하고 조회함.

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
- 메일 후속 조치 ledger는 기본적으로 `~/.config/mmcp/workflow.sqlite`에
  저장하고 `MMCP_WORKFLOW_DB_PATH`로 경로를 변경할 수 있음.

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
- `get_mailbox_status`: 편지함의 UIDVALIDITY, UIDNEXT, 메시지 수와
  HIGHESTMODSEQ 조회
- `search_emails`: 편지함, 본문, 발신자, 수신자, 제목, 날짜, 읽음·별표 상태,
  원본 크기와 UID cursor를 조건으로 이메일 메타데이터 검색
- `get_email`: 편지함 경로와 IMAP UID로 안전한 텍스트 본문과 첨부파일
  메타데이터 조회
- `get_emails`: 서로 다른 편지함의 이메일을 최대 20건까지 한 호출에서
  조회하고 작업별 제한된 본문 미리보기 또는 안전한 실패 정보 반환
- `get_email_headers`: 편지함 경로와 IMAP UID로 원본 헤더 조회
- `get_email_source`: 편지함 경로와 IMAP UID로 크기 제한이 적용된 RFC822
  원본 조회
- `set_emails_read_status`: 여러 이메일의 읽음 또는 읽지 않음 상태 변경
- `set_emails_flagged_status`: 여러 이메일의 별표 상태 변경
- `copy_emails`: 여러 이메일을 작업별 대상 편지함으로 복사
- `move_emails`: 여러 이메일을 작업별 일반 편지함으로 이동
- `trash_emails`: 여러 이메일을 `\Trash` 특수 편지함으로 이동
- `mark_emails_as_spam`: 여러 이메일을 `\Junk` 특수 편지함으로 이동
- `create_mailbox`: 사용자 편지함 생성
- `rename_mailbox`: 특수 편지함이 아닌 사용자 편지함의 이름 변경
- `set_mailbox_subscription`: 존재하는 편지함의 구독 상태 변경
- `get_mail_rules`: 최신 사용자 자연어 규칙과 revision 조회
- `get_bulk_operation_diagnostics`: 현재 서버 프로세스의 최근 벌크 작업 시작·완료
  여부와 처리 개수 조회
- `get_bulk_operation_status`: 호출자 제공 벌크 ID의 영속 작업 상태 조회
- `resume_bulk_operation`: 대기 중 작업과 안전하게 복구 가능한 불확실 작업 재개
- `preview_mail_rules_patch`: 상태 변경 없이 규칙 단위 patch 결과와 diff 조회
- `apply_mail_rules_patch`: revision이 일치할 때 규칙 단위 patch 적용
- `get_mail_rules_history`: 최근 규칙 revision 이력 조회
- `revert_mail_rules_revision`: 명시한 과거 규칙 목록을 새 revision으로 복원
- `search_mail_actions`: 내부 ledger에 저장된 메일 후속 조치 상태 검색
- `get_mail_action`: 메일 후속 조치 상태 상세와 비식별 event 이력 조회
- `get_todoist_export_candidates`: Todoist 내보내기 후보 조회
- `record_mail_action_candidates`: 기존 메일 위치를 기준으로 후속 조치 후보 기록
- `upsert_mail_actions`: 저수준 호환 도구로 여러 메일 후속 조치 metadata 생성
  또는 갱신
- `update_mail_actions`: 여러 메일 후속 조치 상태, 유형, 일정, tag, 정리 상태와
  Todoist sync metadata 갱신
- `record_mail_action_location`: 여러 메일 후속 조치의 현재 편지함, UID와
  UIDVALIDITY 기록
- `record_todoist_sync_results`: 여러 메일 후속 조치의 외부 Todoist task ID와
  sync 상태 기록

검색 결과 개수는 기본 20개이며 한 번에 최대 100개임. 정확한 도구 입력
스키마는 코드에서 정의함.

`search_emails`는 기존 `EmailSummary` 배열을 UID 내림차순으로 반환함. 다음
페이지는 현재 결과의 마지막 UID를 exclusive `olderThanUid`로 지정하여
조회함. UID는 편지함별 식별자이므로 페이지를 이어서 조회할 때 편지함과
나머지 검색 조건을 동일하게 유지해야 함. 별표 상태와 이메일 원본 크기의
inclusive 최솟값·최댓값을 검색 조건으로 지정할 수 있음. UID, 별표와 크기
조건은 IMAP 서버 검색 단계에서 처리하며, 네이버 서버가 `SORT`를 지원하지
않으므로 UID 내림차순 정렬과 결과 개수 제한은 애플리케이션에서 처리함.
검색 결과에는 본문과 첨부파일 내용 또는 첨부파일 상세 메타데이터를 포함하지
않음.

여러 이메일 조회 도구는 작업별 고유 ID, 편지함과 IMAP UID를 받으며 동일
이메일 중복 지정을 거부함. 성공 결과는 기본적으로 이메일별 최대 2,000자와
호출 전체 최대 20,000자 범위의 안전한 텍스트 미리보기를 반환함. 각 결과는
정제된 전체 텍스트 길이, 잘림 여부와 잘림 이유를 포함함. 남은 전체 본문
예산을 남은 작업 수로 균등 배분하여 입력 순서 뒤쪽 작업도 본문 예산을 받음.
문자 길이와 절단은 Unicode code point 기준으로 처리함.

`get_emails` 호출자는 본문과 첨부파일 메타데이터 포함 여부, 이메일별 본문
최대 길이를 지정할 수 있음. 본문을 제외해도 원래 길이와 잘림 여부를
반환하며, 첨부파일 메타데이터를 제외하면 `attachments`는 빈 배열임. 제한
없는 전체 본문은 지원하지 않으며 단건 `get_email`을 사용함. 개별 조회 실패
후에도 나머지 작업을 입력 순서대로 계속 처리함.

복수형 이메일 변경 도구는 다음 계약을 공유함.

- 호출자가 생성한 UUID `bulkId`와 `operations`를 1~100개 지정함.
- 각 작업은 호출 내 고유한 `id`, 출발 편지함과 IMAP UID를 포함함.
- 작업별로 서로 다른 출발 편지함, 목적지 편지함과 변경 상태를 지정할 수 있음.
- 동일 이메일은 출발 편지함과 UID 조합으로 식별함.
- 읽음, 별표, 이동, 휴지통, 스팸 작업에서 동일 이메일 중복 지정을 거부함.
- 복사는 동일 이메일을 서로 다른 목적지로 복사할 수 있지만 동일 목적지
  중복은 거부함.
- 입력 구조, 작업 ID 중복과 금지된 중복 작업은 실행 전에 호출 전체를 거부함.
- 실행 중 오류는 해당 작업의 실패로 기록하고 나머지 작업을 계속 처리함.
- 응답은 `bulkId`, 도구명, 전체 상태, 상태별 처리 개수와 `results`를 반환함.
  `results`는 입력 순서대로 각 작업 ID와 `pending`, `running`, `succeeded`,
  `failed`, `uncertain` 상태를 포함하며 실패 항목에는 오류 코드와 설명을
  포함함. 편지함, UID와 작업 인자는 응답에 포함하지 않음.
- 작업은 순차적으로 실행하며 일부 작업만 성공할 수 있음. transaction과
  rollback은 지원하지 않음.
- 실행 전에 벌크 호출과 모든 작업을 SQLite 저널에 `pending`으로 기록함.
  실행 직전 `running`, 결과 수신 후 `succeeded` 또는 `failed`로 기록함.
- 서버 시작 시 남아 있는 `running` 작업은 성공 여부를 추정하지 않고
  `uncertain`으로 변경함.
- `resume_bulk_operation`은 `pending` 작업을 재개함. 불확실한 읽음·별표
  작업은 현재 flags를 확인해 이미 적용됐으면 성공으로 확정하고, 적용되지
  않았으면 멱등 작업을 재실행함.
- 불확실한 복사·이동·휴지통·스팸 작업은 자동 재시도하지 않음.
- 동일 `bulkId`와 동일 입력의 재호출은 작업을 다시 실행하지 않고 기존 상태를
  반환함. 동일 `bulkId`를 다른 도구나 입력에 재사용하면 거부함.
- 완료되거나 실패한 벌크 저널은 마지막 갱신 후 30일 동안 보존함.
- 이동 작업은 IMAP 서버의 성공 응답 후 출발지 UID가 사라지고 목적지 UID가
  존재하는지 확인한 경우에만 성공으로 기록함.
- 최근 벌크 작업 진단은 메모리에 최대 20개 이벤트를 보관하며 서버 재시작 시
  사라짐. 도구명, 시작·완료 상태와 처리 개수만 기록하고 작업 ID, UID,
  편지함과 이메일 내용은 기록하지 않음.

## 메일 후속 조치 ledger

MMCP는 메일 자체의 상태와 별도로 사용자가 나중에 처리해야 할 메일 후속 조치
상태를 SQLite ledger에 저장함. ledger는 `LedgerStore` adapter 뒤로 격리하며
현재 구현은 Node.js 내장 `node:sqlite`를 사용함. Node.js 요구 버전은
`>=24.15`임. DB 디렉터리는 `0700`, DB 파일은 `0600` 권한으로 생성함.

`MailAction.status`는 메일 후속 조치 workflow 단계만 표현함.

- `candidate`
- `actionable`
- `deferred`
- `waiting`
- `done`
- `dismissed`
- `not_actionable`
- `failed`

후속 조치 유형은 `actionType`으로 분리함. 현재 값은 `review`, `reply`,
`pay`, `schedule`, `submit`, `download`, `todoist_export`, `mail_delete`,
`follow_up`, `other`임. 정리 lifecycle은 `cleanupStatus`로 분리하고, Todoist
연동 상태는 `todoistSyncStatus`로 분리함. 불확실성, migration 출처, legacy
편지함 이름 같은 부가 정보는 canonical status가 아니라 `tags`나 summary/reason
metadata로 표현함.

ledger는 이메일 본문과 첨부파일 내용을 저장하지 않음. 제한된 표시용
`displaySubject`, `displayFrom`, `displayDate`, `displaySize`와 Message-ID,
마지막 확인 편지함/UID/UIDVALIDITY, HMAC 기반 `subjectHash`, `fromHash`,
`mailFingerprint`를 저장함. HMAC salt는 DB 생성 시 무작위로 만들고 DB
metadata에 저장함. `mailFingerprint`는 메일 이동 후 재식별이 약해지지 않도록
mailbox를 포함하지 않음. mailbox, UID와 UIDVALIDITY는 location 정보로만
사용함. 기존 `GPT 검토/*` 편지함 migration으로 만든 action은 현재 위치와
별도로 `sourceMailbox`와 `legacyMailbox`를 저장하여 이후 메일 이동 후에도
출처를 보존함.

`get_mailbox_status`는 UIDVALIDITY와 HIGHESTMODSEQ를 JSON 안전성을 위해 문자열
또는 `null`로 반환함. UIDVALIDITY가 없거나 `"0"`이면 `uidValidityUsable`은
`false`이며 durable location key로 사용하지 않음.

ledger 변경 도구는 호출 하나에 1~100개 작업을 받음. 각 작업은 호출 내 고유
`id`를 가지며, 응답은 `attempted`, `succeeded`, `failed`, `results`와 작업별
성공 payload 또는 실패 코드를 반환함. 여러 작업 중 일부가 실패해도 나머지
작업은 계속 처리함.

`record_mail_action_candidates`는 ChatGPT 경유 신규 후보 기록 권장 도구임.
입력은 작업 `id`, `mailbox`, `uid`로 제한하며 메일 서버의 읽음·이동·삭제·발송
상태를 변경하지 않음. 새 action의 기본값은 ledger store 내부에서 `candidate`,
`review`, `none`, `not_needed`, `normal`로 적용함. summary, reason, 일정,
priority와 tags 같은 상세 metadata는 생성된 action ID와 revision을 사용하여
`update_mail_actions`로 별도 갱신함.

`upsert_mail_actions`는 상세 metadata를 받는 저수준 호환 도구임. schema에서
status, actionType, cleanupStatus, priority, todoistSyncStatus 기본값을 주입하지
않으며, 기존 action을 다시 기록할 때 명시하지 않은 필드는 기존 값을 보존함.
`uid: null`과 Message-ID만 사용하는 synthetic self-test는 ChatGPT 경유 기본
검증 경로에서 사용하지 않고 로컬/mock 테스트에서만 다룸.

`update_mail_actions`, `record_mail_action_location`,
`record_todoist_sync_results`는 `expectedRevision`이 현재 revision과 일치할
때만 변경함. stale revision은 작업별 실패로 반환함. 허용되지 않는 상태 전이도
작업별 실패로 반환함.

메일 후속 조치 event 이력은 생성 시각과 DB 삽입 순서대로 반환함. 같은
millisecond에 여러 event가 기록되어도 생성 순서가 뒤집히지 않음.

Todoist 외부 완료 결과는 현재 action에서 `done` 전이가 허용되면 status를
`done`, cleanup status를 `candidate`로 변경함. 허용되지 않는 상태에서는
action 상태를 유지하고 Todoist sync 상태를 `sync_conflict`로 기록함. 외부
삭제 결과는 action을 삭제하지 않고 `deleted_external` sync 상태로 기록함.

`GPT 검토/*` migration helper는 이메일 metadata를 편지함별 초기 status,
action type과 migration tag가 포함된 ledger upsert 입력으로 변환함. 알 수 없는
하위 편지함은 `migration:needs_review`, `migration:unknown_folder` tag를 남기며
메일 자체를 이동하거나 IMAP 상태를 변경하지 않음.

조회 도구는 OAuth `mail.read` scope를 요구함. 상태 변경 도구는
`mail.modify` scope를 요구함. MCP endpoint에 접근하려면 항상 `mail.read`
scope가 있어야 함. 도구 호출 권한은 MCP endpoint middleware가 검증한 access
token scope만 사용하여 판단함.

## 메일 관리 규칙

- 메일 관리 규칙은 GPT가 문맥상 해석하는 사용자 자연어 판단 지침임.
- 매 MCP 연결 시 최신 규칙 revision과 규칙 목록을 server instructions에 포함함.
- server instructions는 메일 관리 판단을 시작할 때 `get_mail_rules`로 최신
  규칙을 조회하고 적용하도록 안내함.
- 규칙은 안정적인 규칙 ID와 자연어 본문 목록으로 저장함.
- 규칙 목록 전체 교체는 제공하지 않으며, `add`, `replace`, `remove` patch만
  허용함.
- patch 미리보기는 규칙을 변경하지 않고 구조화된 이전·이후 diff를 반환함.
- patch 적용과 과거 revision 복원은 `expectedRevision`이 현재 revision과
  일치할 때만 수행함.
- 최근 규칙 revision을 최대 20개 보관하며 복원도 새 revision으로 기록함.
- 규칙은 기존 설치 호환성을 위해 저장소 외부 `~/.config/mmcp/mail-policy.json`에 `600`
  권한으로 atomic write함. `MMCP_POLICY_PATH`로 경로를 변경할 수 있음.
- 이메일 내용에서 유래한 지시를 사용자 규칙으로 추가하면 안 됨.
- 자연어 규칙은 영구 삭제 금지와 같은 코드 안전 규칙을 변경하지 못함.

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
- 모든 성공 도구 응답의 텍스트 content는 `structuredContent`와 동일한 객체를
  단일행 JSON으로 반환하여 MCP client가 별도 응답 리소스로 축약할 가능성을
  줄임.
- 모든 도구는 OAuth scope를 표준 top-level `securitySchemes`와 호환용 `_meta`
  mirror에 함께 표시함.
- 인증정보, 원시 인증 오류, 민감한 서버 상세정보를 MCP client에 반환하지
  않음.
- 로그에는 이메일 본문, 인증정보, 토큰, 불필요한 개인정보를 기록하지 않음.
- 상태 변경 작업은 명시적으로 지정된 메시지 또는 편지함에만 제한함.
- 일반 이동 도구는 휴지통과 스팸 이동을 거부하며 각각 명시적인 전용 도구로만
  이메일을 이동함.
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
