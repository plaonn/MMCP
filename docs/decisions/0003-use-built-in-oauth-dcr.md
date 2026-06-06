# 내장 OAuth 2.1과 DCR 사용

## 상태

승인됨

## 배경

MMCP는 개인 이메일 데이터와 상태 변경 도구를 외부 HTTPS endpoint로 제공함.
ChatGPT에서 인증된 MCP 서버로 연결하려면 OAuth 2.1 authorization-code flow와
PKCE, protected resource metadata, authorization server metadata가 필요함.

개인용 단일 사용자 서버이므로 별도 외부 IdP를 운영하면 배포와 관리 복잡도가
과도하게 증가함. ChatGPT OAuth client를 사전에 고정 등록하면 connector별
redirect URI를 수동으로 관리해야 함.

## 결정

- MMCP에 개인용 단일 사용자 OAuth 2.1 authorization server를 내장함.
- ChatGPT OAuth client 등록에는 Dynamic Client Registration(DCR)을 사용함.
- OAuth client ID와 access token은 서버 비밀값으로 서명한 무상태 값으로
  발급하여 서버 재시작 후에도 검증 가능하게 함.
- authorization code는 5분 수명의 일회성 메모리 값으로 관리함.
- 인가 화면에서 별도 소유자 비밀번호를 확인한 후에만 code를 발급함.
- access token 수명은 1시간, refresh token 수명은 30일로 제한함.
- OAuth resource는 공개 MCP endpoint 전체 URL을 사용함.
- 조회 도구는 `mail.read`, 상태 변경 도구는 `mail.modify` scope를 요구함.

## 결과

- 외부 IdP 없이 ChatGPT가 표준 OAuth discovery와 DCR을 통해 연결할 수 있음.
- 서버 재시작 시 기존 access token과 DCR client ID는 계속 검증 가능함.
- 진행 중이던 authorization code는 서버 재시작 시 무효화됨.
- OAuth 소유자 비밀번호와 서명 비밀값을 서버 환경변수로 별도 관리해야 함.
- refresh token이 만료되면 사용자가 다시 승인해야 함.
