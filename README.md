# MMCP

IMAP을 통해 수신 이메일을 관리하는 개인용 모바일 우선 MCP 서버임.

현재 읽기 전용 MVP가 구현되어 있음. 네이버 메일의 편지함 목록, 이메일 검색,
개별 이메일 본문 조회를 Streamable HTTP MCP 도구로 제공함.

## 요구 환경

- Node.js 22 이상
- 네이버 메일에서 활성화한 IMAP
- 네이버 2단계 인증과 애플리케이션 비밀번호

## 시작

```bash
npm install
cp .env.example .env
```

`.env`에 네이버 이메일 주소, 애플리케이션 비밀번호, 충분히 긴 무작위
`MMCP_BEARER_TOKEN`을 설정함. 실제 비밀값이 들어간 `.env`는 Git에서 제외됨.

네이버 연결만 안전하게 확인하려면 다음 명령을 실행함. 이메일 주소, 편지함
이름, 메일 내용은 출력하지 않음.

```bash
npm run check:imap
```

```bash
npm run build
npm start
```

기본 MCP 접속 주소는 `http://127.0.0.1:3000/mcp`임. 현재 서버는 개발용 bearer
token 인증을 사용함. 외부 연결 전에는 HTTPS 종료 구성이 필요하며, ChatGPT
연결에 필요한 최종 인증 방식은 별도로 검증해야 함.

## MCP 도구

- `check_connection`: 네이버 IMAP 연결 확인
- `list_mailboxes`: 편지함 목록 조회
- `search_emails`: 이메일 메타데이터 검색
- `get_email`: 안전한 텍스트 본문과 첨부파일 메타데이터 조회

모든 도구는 읽기 전용임. 메일 삭제, 이동, 읽음 상태 변경, 발송 기능은 아직
제공하지 않음.

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
- [`AGENTS.md`](AGENTS.md): 필수 개발 및 문서 관리 절차
