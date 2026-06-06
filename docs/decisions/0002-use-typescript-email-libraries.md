# TypeScript와 검증된 이메일 라이브러리 사용

## 상태

승인됨

## 배경

MMCP는 Streamable HTTP MCP 서버와 범용 IMAP 이메일 처리를 구현해야 함. 향후
Raspberry Pi 3 배포 가능성도 있으므로 ARM Linux에서 쉽게 실행할 수 있어야 함.
MCP 전송, IMAP 프로토콜, MIME 해석을 직접 구현하면 오류와 보안 위험이 커짐.

## 결정

- Node.js 22와 TypeScript를 사용함.
- MCP 구현에는 공식 MCP TypeScript SDK를 사용함.
- IMAP 구현에는 `imapflow`를 사용함.
- MIME 해석에는 `mailparser`를 사용함.

## 결과

- MCP와 이메일 프로토콜 구현을 검증된 라이브러리에 맡길 수 있음.
- macOS와 ARM Linux에서 동일한 JavaScript 배포물을 사용할 수 있음.
- Raspberry Pi 2의 32-bit 환경 지원 여부는 사용 라이브러리와 Node.js 배포판에
  따라 제한될 수 있음.
- dependency 업데이트와 보안 공지 확인이 필요함.

## 검토한 대안

- Python은 사용할 수 있지만 공식 MCP TypeScript SDK와 Node.js 이메일
  라이브러리 조합이 현재 요구사항에 직접 맞으므로 제외함.
- IMAP과 MIME을 직접 구현하는 방안은 복잡성과 보안 위험 때문에 제외함.
