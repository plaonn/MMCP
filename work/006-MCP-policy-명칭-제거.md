# MCP policy 명칭 제거

## 상태

검증 필요

## 문제

메일 관리 자연어 규칙을 제공하는 MCP 도구가 `policy` 명칭을 사용함.
ChatGPT가 이를 시스템 정책을 변경하는 도구로 오인하면 안전검사에 걸릴 수
있음.

## 원하는 동작

ChatGPT에 노출되는 도구명, 설명, server instructions, 성공 응답과 오류에서
`policy` 또는 `정책` 명칭을 사용하지 않고 사용자 메일 관리 `rules`로
명확하게 표현해야 함.

## 범위

### 포함

- MCP 도구명을 `mail_rules` 계열로 변경
- MCP 도구 title, description과 server instructions를 규칙 용어로 변경
- patch 성공 응답의 `policy` 필드를 `ruleSet`으로 변경
- MCP에 전달될 수 있는 오류 문구를 규칙 용어로 변경
- README, 현재 스펙, 테스트와 장기 설계 결정 갱신
- 기존 `policy` 도구명을 discovery에서 완전히 제거

### 제외

- 기존 저장 데이터 형식 변경
- `MMCP_POLICY_PATH` 환경변수와 기본 `mail-policy.json` 경로 변경
- 내부 `PolicyStore` 클래스와 파일명 리팩터링
- 기존 저장 규칙 내용 변경

## 완료 조건

- [x] `tools/list`에 `policy`를 포함하는 도구명이 없음.
- [x] 규칙 관리 도구 5개가 새 이름으로 동작함.
- [x] MCP 공개 설명, instructions, 성공 응답과 오류에 정책 용어가 없음.
- [x] patch 성공 응답은 `ruleSet`을 반환함.
- [x] 기존 저장 파일과 설정을 그대로 사용할 수 있음.
- [ ] ChatGPT에서 새 도구 schema를 다시 불러와 사용할 수 있음.

## 결정

- 새 도구명은 `get_mail_rules`, `preview_mail_rules_patch`,
  `apply_mail_rules_patch`, `get_mail_rules_history`,
  `revert_mail_rules_revision`으로 정함.
- 내부 저장 구현과 설정 이름은 기존 설치 호환성을 위해 유지함.
- 이전 도구 alias는 안전검사 회피 목적과 충돌하므로 제공하지 않음.

## 미결 사항

- 없음

## 구현 참고

- 내부 patch 결과는 MCP 반환 직전에 `policy`를 `ruleSet`으로 변환함.
- 저장 파일 구조의 `current`, `history`, `rules`는 변경하지 않음.

## 검증

- [x] 관련 자동화 테스트를 통과함.
- [x] MCP 공개 표면에 남은 policy 명칭을 검색함.
- [ ] 필요한 수동 또는 통합 검증을 완료함.
- [x] `docs/SPEC.md`가 구현 동작과 일치함.
- [x] 필요한 장기 결정이 `docs/decisions/`에 기록됨.

검증 결과:

- `npm run typecheck` 통과
- `npm test` 전체 40개 통과
- `npm run build` 통과
- Streamable HTTP `tools/list`에서 기존 `policy` 도구명과 설명이 노출되지 않음
- 규칙 조회, patch 미리보기·적용·이력·복원 mock 테스트 통과
