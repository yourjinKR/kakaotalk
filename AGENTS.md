# 카톡 프로젝트 작업 안내

이 프로젝트는 설치된 KakaoTalk PC의 패키지 UI 근거를 참고해 만든 독립 메신저다. 친구 관리와 채팅을 우선 개발한다. 서비스 이름은 현재 `카톡`이다.

이어 작업할 때 먼저 `docs/PROGRESS.md`를 읽고 필요한 파일만 연다. 설치본 정적 분석과 Evidence는 `docs/reverse-engineering.md`, `docs/evidence/`에 이미 보존했다. 같은 SHA-256의 파일에 대해 PE 분석을 반복하지 않는다. 코드 디컴파일이나 원본 실행 관측을 완료했다고 주장하지 않는다.

- React/TypeScript 화면: `src/`. API·저장소: `server/index.mjs`. PC 셸: `desktop/main.cjs`.
- `npm run build`, `npm test`, `npm run test:ui`, `npm run test:desktop`가 검증 명령이다.
- UI 테스트는 설치된 Chrome과 독립 포트 3101을 사용한다. 사용자 미리보기는 3001, Vite는 5173이다.
- Electron 45 실행 파일은 `npm run desktop:install`로 설치한다. desktop 스크립트는 이를 자동 호출한다.
- `.data`, 실제 Electron 사용자 데이터, localStorage 초안을 임의 초기화하지 않는다. 테스트는 별도 `test-results` 데이터만 사용한다.
- 원본 개인 계정/대화/연락처를 재현 앱에 가져오거나 공식 카카오 서버에 연결하는 기능은 현재 범위가 아니다.
- 관찰된 원본 동작과 독립적으로 선택한 정책을 구분하여 문서화한다. 검증 결과와 후속 항목을 `docs/PROGRESS.md`에 갱신한다.
