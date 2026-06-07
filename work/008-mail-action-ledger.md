# 메일 후속 조치 상태 ledger

## 상태

1차 구현 및 ChatGPT 실사용 검증 완료, migration 후속 작업 대기

## 문제

현재 MMCP는 메일 자체를 검색·조회·이동·분류할 수 있지만, GPT가 판단한
"나중에 처리해야 할 일", "확인했지만 아직 정리하지 않을 일", "처리 완료 후
정리 대기 중인 일" 같은 후속 조치 상태를 서버 내부에 영속적으로 보관하지
않음.

이 상태를 ChatGPT 대화, Notion, Todoist 또는 `GPT 검토` 편지함 이름에만
의존하면 다음 문제가 생김.

- ChatGPT 앱/커넥터 제약 때문에 MMCP와 다른 앱을 동시에 사용하지 못하는
  상황에서 메일 상태 정본이 분산됨.
- `GPT 검토` 편지함은 presentation/triage layer로는 유용하지만 canonical
  workflow state로 쓰기에는 상태 표현과 이력이 부족함.
- Todoist는 사용자-facing action dashboard로는 유용하지만 메일 식별자,
  UID 변경, 메일 이동, cleanup 후보 상태를 MMCP가 직접 복구하기 어려움.
- 대화 임시 작업판은 thread가 바뀌면 상태가 끊김.

## 원하는 동작

MMCP가 메일 후속 조치 상태의 canonical ledger를 서버 내부에 저장해야 함.
GPT는 메일을 분류하거나 후속 조치가 필요하다고 판단할 때 이 ledger에
`MailAction`을 만들고 갱신함. Todoist나 편지함 이동은 ledger의 상태를
표현하거나 후속 처리하는 dashboard/presentation layer로만 사용함.

사용자는 ChatGPT에서 다음을 할 수 있어야 함.

- 특정 메일 또는 검색 결과를 후속 조치 대상으로 등록함.
- 후속 조치 상태를 조회하고 갱신함.
- 나중에 처리할 항목, 처리 완료 항목, 정리 대기 항목을 구분함.
- Todoist export/sync 대상만 안전하게 추출함.
- 메일 이동, UID 변경, 응답 누락 같은 상황에서도 상태를 가능한 범위에서
  복구하거나 불확실 상태로 표시함.

## 범위

### 포함

- SQLite 기반 MMCP 내부 mail action ledger
- `MMCP_WORKFLOW_DB_PATH` 환경변수와 기본 경로 `~/.config/mmcp/workflow.sqlite`
- `MailAction` domain object와 상태 전이
- `get_mailbox_status` read-only 선행 도구
- 메일 후속 조치 생성·조회·수정 MCP 도구
- 여러 action 갱신의 bulk 처리와 per-operation 실패 응답
- Todoist export/sync를 위한 서버 내부 상태와 외부 참조 저장
- 기존 `GPT 검토` 편지함 기반 운용에서 ledger로 옮기는 migration 계획
- UID 변경, 메일 이동, 중복 `Message-ID`, `uidValidity = 0`, Todoist 삭제·완료,
  도구 응답 누락 edge case 처리
- 개인정보 최소 저장, 로그·diagnostics 비식별화
- 단위 테스트와 MCP tool schema 테스트

### 제외

- Todoist를 MMCP의 task manager로 대체
- MMCP 서버가 직접 Todoist API를 호출하는 기능의 1차 구현
- 이메일 본문 또는 첨부파일 내용 저장
- 메일 내용을 자동으로 읽고 독자적으로 action을 생성하는 background worker
- IMAP `EXPUNGE`, 영구 삭제, 휴지통 비우기
- 완전한 exactly-once 처리 보장
- 여러 계정 지원

## 용어

- Notion 작업 ID: `MMCP-LEDGER`
- 코드 domain object: `MailAction`
- 사용자-facing 표현: `메일 후속 조치 상태`
- ledger: MMCP 내부 SQLite에 저장되는 후속 조치 정본
- presentation/triage layer: `GPT 검토` 편지함, Todoist, ChatGPT 대화 화면

## 저장소와 구성

- 기본 DB 경로는 `~/.config/mmcp/workflow.sqlite`임.
- `MMCP_WORKFLOW_DB_PATH`로 DB 경로를 override할 수 있음.
- DB 파일이 있는 디렉터리는 `0700`, DB 파일은 `0600` 권한을 적용함.
- Node.js 요구 버전은 `>=24.15`로 상향함.
- SQLite 접근은 `LedgerStore` adapter 뒤로 격리함.
- 1차 구현은 `node:sqlite`를 사용함.
- `better-sqlite3`는 당장 도입하지 않음.
- DB schema version과 migration table을 둠.

## 개인정보 저장 원칙

본문과 첨부파일 내용은 저장하지 않음.

저장은 hybrid 방식으로 함.

- 제한된 표시용 snapshot:
  - `display_subject`: 최대 200자
  - `display_from`: 최대 320자
  - `display_date`
  - `display_size`
- 식별·복구용 값:
  - `message_id`
  - `subject_hash`
  - `from_hash`
  - `mail_fingerprint`
  - `mailbox`
  - `uid`
  - `uid_validity`
  - `uid_validity_usable`

로그와 diagnostics에는 평문 제목, 발신자, 본문, 첨부파일명, Todoist 제목을
출력하지 않음. 필요하면 action ID, 상태, 처리 개수와 비식별 hash만 사용함.

hash는 서버 내부 secret 또는 DB 생성 시 만든 random salt 기반 HMAC을 사용함.
단순 hash로 제목·발신자를 재식별할 수 없게 함.

## 메일 식별 전략

### location key

`uidValidity > 0`일 때만 다음 조합을 durable location key로 사용함.

```text
mailbox + uidValidity + uid
```

`uidValidity = 0`이면 값을 저장하되 `uid_validity_usable = false`로 표시하고,
location key만으로 같은 메일을 확정하지 않음.

### fallback identity

`messageId`가 있으면 우선 사용함. 단, 중복 `Message-ID`가 가능하므로
`subject_hash`, `from_hash`, 날짜, size를 조합한 `mail_fingerprint`를 함께
저장함.

INBOX는 특히 이동과 provider 동작에 따라 UID 변화가 사용자 workflow에 영향을
주기 쉬우므로 `messageId`/fingerprint 중심 복구를 우선함.

### mailbox status

선행 read-only 도구로 `get_mailbox_status`를 추가함.

권장 응답:

```json
{
  "mailbox": "INBOX",
  "uidValidity": "123456",
  "uidValidityUsable": true,
  "uidNext": 61550,
  "exists": 1234,
  "highestModseq": null
}
```

- `uidValidity`, `highestModseq`는 JSON 직렬화 안정성을 위해 문자열 또는
  `null`로 반환함.
- `uidValidityUsable`은 `uidValidity`를 durable location key에 사용할 수
  있는지 표시함.
- `uidNext`는 scan watermark 용도로만 사용함.
- `highestModseq`는 1차 ledger 식별과 sync 설계에서는 사용하지 않음.

## 최소 데이터 모델

### `mail_actions`

| 필드 | 설명 |
| --- | --- |
| `id` | 서버가 발급한 안정적인 action ID |
| `status` | 상태 enum |
| `action_type` | 후속 조치 유형 |
| `cleanup_status` | 정리 후보 상태 |
| `cleanup_config` | 정리 방식 지침 |
| `mailbox` | 마지막으로 확인한 편지함 |
| `uid` | 마지막으로 확인한 UID |
| `uid_validity` | 문자열로 저장한 UIDVALIDITY |
| `uid_validity_usable` | location key 사용 가능 여부 |
| `message_id` | 원본 Message-ID |
| `mail_fingerprint` | fallback identity |
| `subject_hash` | 제목 HMAC |
| `from_hash` | 발신자 HMAC |
| `display_subject` | 제한된 표시용 제목 |
| `display_from` | 제한된 표시용 발신자 |
| `display_date` | 표시용 날짜 |
| `display_size` | 표시용 크기 |
| `summary` | GPT가 만든 짧은 후속 조치 설명 |
| `reason` | 후속 조치로 둔 이유 |
| `due_at` | 처리 목표 시각 |
| `deferred_until` | 다시 볼 시각 |
| `priority` | 낮음/보통/높음 |
| `tags_json` | JSON 배열 문자열, `TEXT NOT NULL DEFAULT '[]'` |
| `todoist_task_id` | 외부 Todoist task ID |
| `todoist_sync_status` | Todoist export/sync 상태 |
| `created_at` | 생성 시각 |
| `updated_at` | 갱신 시각 |
| `last_seen_at` | 메일 위치를 마지막 확인한 시각 |
| `completed_at` | 후속 조치 완료 시각 |
| `revision` | 낙관적 동시성 제어용 정수 |

### `mail_action_events`

상태 변경 이력을 저장함.

| 필드 | 설명 |
| --- | --- |
| `id` | event ID |
| `action_id` | 대상 action |
| `event_type` | created/status_changed/location_updated/todoist_synced 등 |
| `before_status` | 이전 상태 |
| `after_status` | 이후 상태 |
| `created_at` | event 시각 |
| `metadata_json` | 비식별 부가 정보 |

### `mailbox_scan_state`

편지함별 scan watermark를 저장함.

| 필드 | 설명 |
| --- | --- |
| `mailbox` | 편지함 |
| `uid_validity` | 마지막 확인한 UIDVALIDITY |
| `uid_validity_usable` | 사용 가능 여부 |
| `uid_next` | 마지막 확인한 UIDNEXT |
| `last_scanned_uid` | 마지막 scan 기준 UID |
| `updated_at` | 갱신 시각 |

## 상태 enum

### 주요 상태

`MailAction.status`는 메일 후속 조치의 workflow 단계만 표현함. cleanup
lifecycle, migration 출처, Todoist sync 상태, 불확실성은 별도 필드, tag 또는
metadata로 표현함.

- `candidate`: GPT가 후속 조치 가능성을 발견했지만 아직 확정하지 않음.
- `actionable`: 사용자가 처리해야 할 후속 조치로 확정됨.
- `deferred`: 일정 시점 이후 다시 볼 항목.
- `waiting`: 외부 응답이나 사용자 입력을 기다리는 항목.
- `done`: 후속 조치 자체는 완료됨.
- `dismissed`: 이번에는 숨기지만 action 가능성 자체를 부정하지 않음.
- `not_actionable`: 후속 조치 대상이 아님.
- `failed`: 시도한 후속 조치가 실패하여 재시도 또는 확인이 필요함.

`cleanup_ready`와 `cleaned_up`은 `MailAction.status`에 넣지 않고 cleanup
lifecycle로 분리함. `uncertain`은 status에 넣지 않고 tag 또는 metadata로
처리함.

### action type

- `review`: 사람이 확인해야 함.
- `reply`: 답장 필요.
- `pay`: 결제 또는 납부 필요.
- `schedule`: 일정 확인 또는 등록 필요.
- `submit`: 제출 또는 입력 필요.
- `download`: 파일 확인 또는 다운로드 필요.
- `todoist_export`: Todoist 사용자-facing action으로 내보낼 항목.
- `mail_delete`: 메일 삭제 또는 휴지통 이동 검토 항목.
- `follow_up`: 기타 후속 조치.
- `other`: 분류되지 않은 후속 조치.

### Todoist sync 상태

- `not_needed`: Todoist 노출 대상이 아님.
- `export_ready`: Todoist에 만들 항목임.
- `exported`: Todoist task ID가 기록됨.
- `sync_conflict`: Todoist 상태와 ledger 상태가 충돌함.
- `deleted_external`: Todoist task가 외부에서 삭제됨.
- `completed_external`: Todoist task가 외부에서 완료됨.

### cleanup 상태

- `none`: 정리 대상 아님.
- `candidate`: 정리 후보.
- `approval_required`: 사용자 승인 필요.
- `ready`: cleanup config에 따라 처리 가능.
- `completed`: 정리 완료.
- `blocked`: 정리할 수 없음.

## 상태 전이

```text
candidate -> actionable
candidate -> not_actionable
candidate -> dismissed
candidate -> deferred

actionable -> waiting
actionable -> deferred
actionable -> done
actionable -> dismissed
actionable -> failed

deferred -> actionable
waiting -> actionable
waiting -> done
waiting -> failed

done -> actionable
failed -> actionable
failed -> dismissed
```

`dismissed`, `not_actionable`, `deferred`는 서로 다른 의미임.

- `dismissed`: 지금은 감추지만 나중에 새 단서가 있으면 다시 후보가 될 수 있음.
- `not_actionable`: 후속 조치 대상이 아니라고 판정함.
- `deferred`: 처리해야 할 가능성이 있으며 지정 시점 이후 다시 봄.

Todoist 완료 후에는 바로 메일을 이동하거나 정리하지 않음. 먼저
cleanup `candidate` 또는 `ready`로 전환하고, `cleanup_config`에 따라 사용자
승인 또는 상황별 처리를 수행함.

## cleanup config

기본 cleanup 설정은 다음과 같음.

```json
{
  "cleanupOnStartup": false,
  "dryRunDefault": true,
  "terminalRetentionDays": 180,
  "staleUnmatchedRetentionDays": 90,
  "mailboxSnapshotRetentionDays": 30,
  "todoistExportLogRetentionDays": 180,
  "vacuumAfterCleanup": true
}
```

- 비종결 상태는 자동 cleanup 대상에서 제외함.
- cleanup은 기본적으로 dry-run으로 동작함.
- 서버 시작 시 자동 cleanup을 실행하지 않음.
- `done`, `not_actionable`, `dismissed`처럼 종결 또는 terminal로
  취급할 수 있는 항목만 보존 기간 정책의 후보가 될 수 있음.
- `vacuumAfterCleanup`은 실제 삭제가 발생한 cleanup 후에만 적용함.

## 권장 MCP 도구

### 1단계: mailbox status

`get_mailbox_status`

- scope: `mail.read`
- read-only
- 입력:

```json
{ "mailbox": "INBOX" }
```

- 출력: `mailbox`, `uidValidity`, `uidValidityUsable`, `uidNext`, `exists`,
  `highestModseq`

### 2단계: ledger 조회

`search_mail_actions`

- scope: `mail.read`
- read-only
- 상태, 편지함, tag, due/deferred 조건, Todoist sync 상태로 action 검색
- 본문과 첨부파일 내용은 반환하지 않음.

`get_mail_action`

- scope: `mail.read`
- read-only
- action ID 하나의 상세 metadata와 event 요약 조회

### 3단계: ledger 변경

`upsert_mail_actions`

- scope: `mail.modify`
- bulk tool
- 검색 결과나 `get_email` 결과에서 후속 조치 후보/확정 action 생성 또는 갱신
- operation별 `id`를 받고 partial success 반환
- 동일 메일 identity가 이미 있으면 새 action을 만들지 않고 기존 action을
  갱신하거나 conflict를 반환함.

`update_mail_actions`

- scope: `mail.modify`
- bulk tool
- 상태, action type, due/deferred, priority, tags, cleanup config, Todoist sync
  metadata 갱신
- `expectedRevision`으로 stale update를 거부함.

`record_mail_action_location`

- scope: `mail.modify`
- bulk tool
- 이동 또는 재검색 후 확인된 현재 편지함/UID/UIDVALIDITY를 갱신함.

### 4단계: Todoist export/sync

`get_todoist_export_candidates`

- scope: `mail.read`
- read-only
- `todoist_sync_status = export_ready`인 action을 사용자-facing task payload로 반환

`record_todoist_sync_results`

- scope: `mail.modify`
- bulk tool
- 외부에서 생성·완료·삭제된 Todoist task ID와 상태를 ledger에 기록함.

1차 구현에서는 MMCP가 직접 Todoist API를 호출하지 않음. ChatGPT가 Todoist를
동시에 사용할 수 없는 제약이 계속 문제가 되면 별도 후속 작업으로 서버 내부
Todoist API 연동을 검토함.

## 도구 응답 원칙

- 모든 변경 도구는 기존 벌크 변경 도구와 같은 `attempted`, `succeeded`,
  `failed`, `results` 구조를 사용함.
- 실패 항목에는 action ID 또는 operation ID, 안전한 오류 코드와 설명만 반환함.
- 로그와 diagnostics에는 메일 제목·발신자·본문·첨부파일명·Todoist 제목을
  남기지 않음.
- 성공 도구 응답의 `content.text`는 `structuredContent`와 같은 compact JSON을
  유지함.

## GPT 검토 편지함 migration

기존 `GPT 검토/*` 편지함은 계속 사용할 수 있지만 canonical state는 ledger로
옮김.

1. `list_mailboxes`로 `GPT 검토` 하위 편지함을 찾음.
2. `get_mailbox_status`로 각 편지함의 UIDVALIDITY와 UIDNEXT를 기록함.
3. `search_emails`로 각 편지함의 메타데이터를 페이지 단위로 조회함.
4. 편지함 이름을 enum으로 만들지 않고 `sourceMailbox`, `legacyMailbox`와
   tag로 보존함.
5. `upsert_mail_actions`로 action을 생성함.
6. migration 직후에는 메일을 이동하지 않음.
7. 중복 `Message-ID`나 fingerprint 충돌은 tag/metadata에 uncertainty나
   conflict로 남기고 사용자 확인을 요구함.

초기 mapping:

| legacy mailbox | 초기 상태 | action type | tag |
| --- | --- | --- | --- |
| `GPT 검토` | `candidate` | `review` | `migration:needs_review` |
| `GPT 검토/확인 필요` | `candidate` | `review` | `migration:needs_review` |
| `GPT 검토/MMCP 개선` | `actionable` | `todoist_export` | `migration:todoist_export_pending`, `topic:mmcp` |
| `GPT 검토/삭제` | `actionable` | `mail_delete` | `migration:mail_delete_pending`, `decision:delete` |
| `GPT 검토/삭제 예정` | `actionable` | `mail_delete` | `migration:mail_delete_pending`, `decision:delete` |
| `GPT 검토/보류` | `deferred` | `follow_up` |  |
| `GPT 검토/나중에` | `deferred` | `follow_up` |  |
| `GPT 검토/완료` | `done` | `follow_up` | `migration:resolved` |
| `GPT 검토/처리 완료` | `done` | `follow_up` | `migration:resolved` |
| 알 수 없는 `GPT 검토/*` | `candidate` | `review` | `migration:needs_review`, `migration:unknown_folder` |

위 표의 `status`는 장기 `MailActionStatus` enum에 포함되는 정규 상태만
사용함. `needs_review`, `todoist_export_pending`, `mail_delete_pending`,
`resolved` 같은 migration 전용 상태명은 장기 enum에 넣지 않고 tag로만 보존함.

GPT 검토 편지함 출처, migration 판정, legacy mailbox 이름은 tags 또는
metadata로 보존함. 초기 구현은 `tags_json TEXT NOT NULL DEFAULT '[]'`로 단순
구현하고, tag 검색이 실제로 필요해지면 이후
`mail_action_tags(action_id, tag)` 테이블로 분리함.

## edge case

- UID 변경: `message_id`와 fingerprint로 재검색하여 위치를 갱신함.
- 메일 이동: 변경 도구 성공 결과의 destination UID가 있으면 location을 갱신함.
- `uidValidity = 0`: location key를 확정 식별자로 쓰지 않고 fallback identity를
  우선함.
- 중복 `Message-ID`: fingerprint와 위치를 함께 비교하고 자동 병합하지 않음.
- Todoist task 삭제: action을 삭제하지 않고 `deleted_external` 또는
  `sync_conflict`로 표시함.
- Todoist task 완료: action을 `done`으로 전환하고 cleanup lifecycle을
  `candidate` 또는 `ready`로 표시함. 메일 정리는 별도 정리 설정에 따름.
- 도구 응답 누락: ledger mutation은 revision과 event log로 재조회 가능하게 함.
- 일부 성공: bulk response에서 실패 operation만 재시도할 수 있게 operation ID를
  유지함.
- 메일이 실제로 사라짐: 자동 성공 처리하지 않고 tag 또는 metadata에
  `location:uncertain`을 남기거나 cleanup `blocked`로 남김.

## 완료 조건

- [x] `get_mailbox_status`가 편지함 status를 bigint-safe JSON으로 반환함.
- [x] `MMCP_WORKFLOW_DB_PATH`와 기본 DB 경로가 동작함.
- [x] ledger DB schema와 migration이 자동 초기화됨.
- [x] `MailAction` 생성, 조회, 상태 변경이 MCP 도구로 가능함.
- [x] bulk mutation이 partial success와 `expectedRevision`을 지원함.
- [x] 본문과 첨부파일 내용이 DB, 로그, diagnostics, tool response에 저장되지 않음.
- [x] `dismissed`, `not_actionable`, `deferred`가 별도 상태로 동작함.
- [x] `cleanup_ready`, `cleaned_up`, `uncertain`이 `MailAction.status`에 포함되지 않음.
- [x] `failed`와 `action_type`이 동작함.
- [x] Todoist export 후보와 sync 결과 기록이 가능함.
- [ ] `GPT 검토` 편지함 migration 절차가 mock 또는 fixture 기반으로 검증됨.
- [ ] migration이 `sourceMailbox`, `legacyMailbox`와 mapping tag를 보존함.
- [ ] uidValidity=0, 중복 Message-ID, Todoist 삭제·완료, 도구 응답 누락 edge case
  테스트가 있음.
- [x] `docs/SPEC.md`와 필요한 장기 결정 문서가 구현과 일치함.

## ChatGPT 실사용 검증 기록

2026-06-08에 ChatGPT에서 실제 MMCP connector를 통해 다음을 검증함.

- `get_mail_rules`, `check_connection`, `get_server_capabilities`,
  `list_mailboxes`가 정상 응답함.
- `get_mailbox_status`가 `INBOX`에 대해 `uidValidity: "0"`,
  `uidValidityUsable: false`, `uidNext: 61547`, `exists: 4314`,
  `highestModseq: null`을 반환함.
- `search_emails`는 본문과 첨부파일 내용 없이 메타데이터 1건만 반환함.
- `upsert_mail_actions`로 `test:mmcp-ledger` action을 생성함.
- `search_mail_actions`와 `get_mail_action`으로 생성된 action과 `created` event를
  확인함.
- `update_mail_actions`로 `status: dismissed`, `cleanupStatus: none`,
  `test:completed` tag를 반영하고 revision 증가와 `status_changed` event를
  확인함.
- 실제 메일 이동, 삭제, 휴지통 이동, 스팸 처리, 본문 조회, 첨부파일 내용
  조회는 수행하지 않음.

관찰된 `uidValidity: "0"`은 네이버 IMAP 응답 특성으로 보이며, 현재 설계대로
durable location key에는 사용하지 않고 Message-ID와 fingerprint 기반 fallback
identity를 우선해야 함.

## 결정

- Todoist를 대체하는 task 관리자가 아니라 MMCP 내부 mail action ledger를
  구현함.
- `GPT 검토` 편지함은 presentation/triage layer로 유지함.
- canonical workflow state는 SQLite ledger에 둠.
- 개인정보 저장은 표시용 snapshot과 HMAC/fingerprint를 함께 쓰는 hybrid
  방식으로 함.
- `uidValidity > 0`일 때만 `mailbox + uidValidity + uid`를 durable location
  key로 사용함.
- `uidNext`는 scan watermark로만 사용하고 `highestModseq`는 1차 sync 설계에서
  제외함.
- `MailAction.status`는 메일 후속 조치 workflow 단계만 표현하며 cleanup
  lifecycle, uncertainty, migration 출처와 Todoist sync 상태는 별도 축으로 분리함.
- `cleanup_ready`, `cleaned_up`, `uncertain`은 `MailAction.status`에서 제외함.
- `failed`를 `MailAction.status`에 추가함.
- `action_type` 필드를 추가함.
- `dismissed`, `not_actionable`, `deferred`는 분리함.
- Todoist 완료 후 바로 메일을 정리하지 않고 cleanup lifecycle 후보화함.
- SQLite는 `node:sqlite`를 사용하고 `LedgerStore` adapter 뒤로 격리함.
- Node.js 요구 버전은 `>=24.15`로 상향함.
- cleanup 기본값은 시작 시 자동 cleanup 없음, dry-run 기본, 종결 상태만
  retention cleanup 후보, cleanup 후 vacuum 사용으로 정함.
- `GPT 검토/*` migration은 편지함 이름을 enum으로 만들지 않고
  `sourceMailbox`/`legacyMailbox`와 tag로 보존함.
- migration 전용 상태명은 장기 `MailActionStatus` enum에 넣지 않고 정규 상태와
  tag 조합으로 정규화함.
- 초기 tag 저장은 `tags_json TEXT NOT NULL DEFAULT '[]'`로 구현하고, tag 검색
  필요성이 확인되면 별도 tag 테이블로 분리함.

## 미결 사항

- Todoist export/sync를 MMCP 내부 API 연동까지 확장할지 여부는 1차 구현 후
  실제 사용 제약을 보고 결정함.

## 구현 순서

1. `get_mailbox_status`를 `EmailReader`와 MCP read-only 도구로 추가함.
2. Node 요구 버전을 `>=24.15`로 상향하고 `MMCP_WORKFLOW_DB_PATH` 설정과
   `LedgerStore` adapter 인터페이스를 추가함.
3. SQLite schema, migration, 파일 권한, HMAC salt 초기화를 구현함.
4. `MailAction` 타입, action type, 상태 enum, cleanup lifecycle, zod schema와
   상태 전이 검증을 구현함.
5. `search_mail_actions`, `get_mail_action` read-only 도구를 추가함.
6. `upsert_mail_actions`, `update_mail_actions` bulk mutation 도구를 추가함.
7. Todoist export 후보 조회와 sync 결과 기록 도구를 추가함.
8. `record_mail_action_location`과 이동 결과 location update 연계를 추가함.
9. `GPT 검토` 편지함 migration helper 또는 절차 도구를 추가함.
10. README, `docs/SPEC.md`, `docs/decisions/`를 구현 동작에 맞게 갱신함.

## 검증

### 자동 테스트

- [x] `get_mailbox_status`가 `uidValidity`, `highestModseq` bigint를 문자열로
  반환함.
- [x] `uidValidity = 0`은 `uidValidityUsable: false`로 반환함.
- [x] DB 파일과 디렉터리 권한이 제한됨.
- [x] migration이 빈 DB에서 동작함.
- [x] cleanup config 기본값과 retention 대상 제외 규칙이 검증됨.
- [x] `MailAction` upsert가 같은 identity 중복 생성을 막음.
- [x] `action_type` 검증과 검색/갱신이 동작함.
- [x] 상태 전이가 허용된 경로만 통과함.
- [x] cleanup lifecycle과 uncertainty tag/metadata가 status와 분리됨.
- [x] `expectedRevision` 불일치가 stale update로 실패함.
- [x] bulk mutation이 일부 실패 후 나머지 작업을 계속함.
- [x] Todoist export 후보와 sync 결과 기록이 가능함.
- [ ] 평문 제목·발신자가 diagnostics와 로그성 응답에 포함되지 않음.
- [ ] `GPT 검토` migration fixture가 정해진 mapping, 중복과 불확실 항목을
  안전하게 남김.

### 전체 검증

- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] ChatGPT에서 tool schema 갱신 후 read-only 조회와 mock-safe mutation 검증
- [x] `docs/SPEC.md`가 구현 동작과 일치함.
- [x] 필요한 장기 결정이 `docs/decisions/`에 기록됨.
