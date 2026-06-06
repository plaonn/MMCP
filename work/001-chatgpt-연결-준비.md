# ChatGPT 연결 준비

## 상태

진행 중

## 목표

MMCP를 외부 HTTPS endpoint로 안전하게 제공하고 ChatGPT custom MCP 앱으로
연결함.

## 범위

### 포함

- DDNS, 공인 IP, CGNAT, 포트포워딩 조건 확인
- Caddy와 Let's Encrypt를 사용한 HTTPS endpoint 구성
- 외부 네트워크에서 MCP endpoint 연결 검증
- ChatGPT 호환 인증 방식 설계 및 구현
- ChatGPT에서 MCP 도구 검색 및 호출 검증
- 서비스 자동 시작과 기본 운영 안전장치

### 제외

- 이메일 기능 추가
- SMTP 및 이메일 발송
- 삭제 및 휴지통 이동
- 라즈베리파이 이전

## 작업 단계

### 1. 네트워크 조건 확인

- [x] 서버 후보 장비의 LAN 주소 확인: `192.168.0.80`
- [x] 로컬 `80`, `443` 포트가 비어 있음을 확인
- [x] Caddy/nginx 미설치, Homebrew 설치 상태 확인
- [x] 외부에서 확인되는 주소가 일반 공인 IPv4 대역임을 확인
- [x] 공유기 WAN IP와 외부 공인 IP가 같음을 확인하여 CGNAT가 아님을 판단
- [x] `mac.plaonn.com`이 외부 공인 IP를 가리키는지 확인
- [x] 내부 Caddy HTTPS 포트로 `8443` 선택
- [x] 공유기에서 외부 TCP `443`을 `192.168.0.80:8443`으로 포트포워딩

### 2. HTTPS endpoint 구성

- [x] Caddy 설치
- [x] DDNS 도메인용 Caddy 설정 작성
- [x] 외부 `443`과 Caddy 내부 `8443`을 연결하여 TLS-ALPN-01 challenge와
  자동 갱신을 사용하는 방식 결정
- [x] Let's Encrypt 인증서 발급 확인
- [x] `https://mac.plaonn.com/mcp`가 MMCP로 전달되는지 확인
- [x] 외부 무인증 MCP 요청이 `401`로 거부되는지 확인
- [x] 외부 인증된 MCP 연결에서 도구 6개를 조회할 수 있는지 확인

### 3. ChatGPT 호환 인증

- [ ] ChatGPT가 요구하는 인증 방식과 metadata 확정
- [ ] OAuth scope 설계: 조회와 상태 변경 분리 검토
- [ ] OAuth 및 MCP 보호 자원 metadata 구현
- [ ] access token 검증과 `401 WWW-Authenticate` 응답 구현
- [ ] 무인증 접근이 불가능함을 확인

### 4. ChatGPT 연결 검증

- [ ] ChatGPT Developer mode에서 MCP endpoint 등록
- [ ] MCP 도구 목록이 정확히 검색되는지 확인
- [ ] 조회 도구 호출 확인
- [ ] 상태 변경 도구 호출과 사용자 확인 동작 확인

### 5. 운영 준비

- [ ] MMCP와 Caddy 자동 시작 및 장애 후 재시작 구성
- [ ] 요청 timeout과 rate limit 구성
- [ ] 로그 순환과 비밀정보 미기록 확인
- [ ] 인증서 자동 갱신 확인

## 결정

- TLS 종료와 reverse proxy에는 Caddy를 사용함.
- HTTPS 인증서는 무료 Let's Encrypt 인증서를 사용함.
- MMCP 애플리케이션은 로컬 HTTP endpoint로 유지하고 외부 HTTPS는 Caddy가
  처리함.
- 외부 TCP `443`을 Mac의 Caddy TCP `8443`으로 포트포워딩함.
- Caddy는 `8443`에서 TLS를 종료하고 MMCP `127.0.0.1:3000`으로 전달함.
- 외부 `80`은 사용하지 않으며, 외부 `443`은 ChatGPT와 Let's Encrypt
  TLS-ALPN-01 challenge를 위해 사용함.
- 인증 적용 전에는 공개 endpoint 운영 시간을 최소화함.

## 현재 확인 사항

- 서버 후보 장비: macOS MacBook Air
- LAN 주소: `192.168.0.80`
- 기본 gateway 및 공유기 관리 주소 후보: `192.168.0.1`
- 외부에서 확인되는 주소: 일반 공인 IPv4 대역. 정확한 주소는 문서에 기록하지
  않음.
- 공유기 WAN IP와 외부 공인 IP가 같아 CGNAT 환경이 아님.
- DDNS 도메인 `mac.plaonn.com`의 A record가 외부 공인 IP와 일치함.
- `plaonn.com`의 DNS nameserver는 DNSZi를 사용함.
- 로컬 `80`, `443` 포트: 사용 중인 프로세스 없음
- Homebrew: `/opt/homebrew/bin/brew`
- Caddy `2.11.4` 설치 완료
- Let's Encrypt 인증서 발급 완료
- 공개 endpoint: `https://mac.plaonn.com/mcp`
- Caddy가 외부 host를 검증한 뒤 upstream `Host`를 `127.0.0.1`로 변경하여
  MMCP의 localhost DNS rebinding 보호를 유지함.
- 예시 bearer token이 설정된 상태를 발견하여 무작위 256-bit token으로
  교체하고 `.env` 권한을 `600`으로 제한함.

## 미결 사항

- ChatGPT 연결용 최종 인증 방식

## 주의사항

- `.env`, 인증정보, 실제 이메일 데이터를 저장소나 작업 파일에 기록하지 않음.
- 포트포워딩 후 인증 없는 MCP endpoint를 장시간 공개하지 않음.
- 실제 포트포워딩 변경은 사용자가 공유기 관리 화면에서 수행함.

## 검증

- [ ] 각 단계 완료 시 이 파일의 체크리스트와 현재 확인 사항을 갱신함.
- [ ] 관련 자동화 테스트를 통과함.
- [ ] `docs/SPEC.md`와 구현 동작이 일치함.
- [ ] 필요한 장기 결정이 `docs/decisions/`에 기록됨.
