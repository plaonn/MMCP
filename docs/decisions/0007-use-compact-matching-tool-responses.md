# 도구 텍스트 응답과 구조화 응답을 일치시킴

## 상태

승인됨

## 배경

MCP 도구 성공 응답은 모델이 읽는 `content`와 구조화된
`structuredContent`를 함께 반환할 수 있음. MMCP는 기존에 같은 결과를
반환하면서도 `content.text`에는 여러 줄로 정렬한 내부 값만 넣고,
`structuredContent`에는 최상위 `result` 객체를 포함했음.

ChatGPT Atlas에서 여러 이메일 이동 결과의 텍스트 응답이 별도 응답
리소스의 스니펫처럼 축약되어, 모델이 직접 `attempted`, `succeeded`,
`failed`, `results` 전체를 확인하지 못한 사례가 있었음. MMCP의 raw MCP
응답에는 전체 `structuredContent`가 존재했고, Atlas가 표시한
`display_url`, `display_title` 필드는 MMCP와 MCP SDK에서 생성하지 않았음.

Atlas의 내부 축약 기준은 공개된 계약이 아니므로 클라이언트의 구체적인 표시
동작에 의존하지 않으면서 응답의 중복 표현 차이와 불필요한 줄 수를 제거해야
함.

## 결정

- 모든 성공 도구 응답의 `content.text`는 `structuredContent`와 동일한
  최상위 객체를 JSON으로 직렬화함.
- 텍스트 JSON은 pretty-print하지 않고 단일행 compact JSON으로 반환함.
- `structuredContent`는 도구 output schema에 맞는 기준 구조화 응답으로
  유지함.
- 도구별로 별도 resource content나 클라이언트 전용 표시 wrapper를 추가하지
  않음.
- 회귀 테스트에서 in-memory MCP 호출과 Streamable HTTP 응답 모두
  `content.text`를 파싱한 값이 `structuredContent`와 같은지 확인함.

## 결과

- 모델과 MCP client가 어느 응답 표현을 사용하더라도 같은 전체 결과를 읽을
  수 있음.
- 여러 줄 텍스트 응답이 클라이언트에서 별도 응답 리소스로 축약될 가능성을
  줄임.
- 모든 도구가 같은 공통 응답 형식을 사용하므로 벌크 도구와 일반 도구 사이의
  응답 포맷 차이가 생기지 않음.
- 클라이언트가 자체 정책으로 긴 응답을 축약하는 동작까지 서버가 보장할 수는
  없음.

## 검토한 대안

- `structuredContent`만 반환: 일부 MCP client와 모델이 텍스트 `content`에
  의존할 수 있어 제외함.
- 벌크 도구에만 별도 짧은 요약 텍스트 반환: 텍스트와 구조화 응답이 다시
  달라지고 작업별 결과를 직접 확인할 수 없어 제외함.
- 여러 줄 pretty JSON 유지: 사람이 raw 응답을 읽기는 쉽지만 Atlas에서
  관찰된 축약 문제를 반복할 가능성이 있어 제외함.
