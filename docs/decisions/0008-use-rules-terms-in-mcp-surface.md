# MCP 공개 표면에서 rules 명칭 사용

## 상태

승인됨

## 배경

메일 관리 자연어 판단 지침을 제공하는 MCP 도구가 `policy` 명칭을 사용하면
ChatGPT가 시스템 정책을 변경하는 기능으로 오인하여 안전검사에 걸릴 수 있음.
이 기능은 시스템 정책이 아니라 사용자가 정의한 메일 분류·관리 규칙을
조회하고 수정하는 기능임.

## 결정

- MCP 공개 도구명, 설명, server instructions, 성공 응답과 오류에서는
  `policy` 또는 정책 명칭을 사용하지 않고 `rules`, `ruleSet`, 규칙 명칭을
  사용함.
- 규칙 관리 도구는 `get_mail_rules`, `preview_mail_rules_patch`,
  `apply_mail_rules_patch`, `get_mail_rules_history`,
  `revert_mail_rules_revision`으로 제공함.
- patch 성공 응답은 변경 후 규칙 목록을 `ruleSet` 필드로 반환함.
- 이전 `policy` 도구 alias는 제공하지 않음.
- 기존 설치의 저장 데이터와 설정 호환성을 위해 내부 `PolicyStore`,
  `MMCP_POLICY_PATH`, `mail-policy.json` 이름은 유지함.

## 결과

- MCP 기능의 의미가 사용자 메일 관리 규칙으로 명확해짐.
- ChatGPT 안전검사가 시스템 정책 변경 기능으로 오인할 가능성을 줄임.
- 기존 저장 규칙과 배포 설정은 마이그레이션 없이 유지됨.
- 기존 client는 새 도구 schema를 다시 불러와야 함.

## 검토한 대안

- 기존 도구명을 alias로 유지: discovery에 `policy` 명칭이 계속 노출되어
  변경 목적과 충돌하므로 제외함.
- 내부 저장 구현과 설정 이름까지 모두 변경: 사용자 데이터와 배포 설정
  마이그레이션 위험이 커서 제외함.
