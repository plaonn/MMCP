# 0011. SQLite 메일 후속 조치 ledger 사용

## 상태

승인됨

## 배경

메일 분류 결과와 후속 조치 상태를 ChatGPT 대화, Todoist, Notion 또는
`GPT 검토/*` 편지함 이름에만 두면 상태 정본이 분산됨. ChatGPT 앱/커넥터
제약 때문에 메일 관리 중 다른 앱을 동시에 쓰지 못하는 경우도 있으므로,
MMCP 서버 내부에 후속 조치 상태의 정본이 필요함.

## 결정

- 메일 후속 조치 상태는 MMCP 내부 SQLite ledger에 저장함.
- SQLite 접근은 `LedgerStore` adapter 뒤로 격리함.
- 현재 구현은 Node.js 내장 `node:sqlite`를 사용함.
- Node.js 요구 버전은 `>=24.15`로 올림.
- `better-sqlite3`는 당장 도입하지 않음.
- DB 경로는 `MMCP_WORKFLOW_DB_PATH`로 설정하고 기본값은
  `~/.config/mmcp/workflow.sqlite`임.
- `MailAction.status`는 후속 조치 workflow 단계만 표현함.
- 후속 조치 유형은 `actionType`, 정리 lifecycle은 `cleanupStatus`, Todoist
  연동 상태는 `todoistSyncStatus`로 분리함.
- migration 출처, legacy 편지함 이름, 불확실성 같은 부가 판단은 canonical
  status가 아니라 `tags`나 metadata로 보존함.
- 이메일 본문과 첨부파일 내용은 ledger에 저장하지 않음.

## 결과

장점:

- ChatGPT thread나 외부 presentation layer와 무관하게 후속 조치 상태를
  복구할 수 있음.
- UID 변경, 메일 이동, Todoist sync 누락 같은 상황에서 action ID와 revision을
  기준으로 재조정할 수 있음.
- 상태 enum이 migration이나 Todoist 세부 상태로 오염되지 않음.

단점:

- Node.js 24.15 이상이 필요함.
- SQLite 파일의 백업, migration, 정리 작업을 MMCP 운영 범위에 포함해야 함.
- `node:sqlite`는 현재 런타임에서 experimental warning을 출력할 수 있음.
