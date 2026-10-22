# 카톡

친구 관리와 대화에 집중하는 독립 PC 메신저입니다. 설치된 KakaoTalk PC 26.9.0.5337의 패키지 UI 리소스를 조사하여 기능 흐름을 참고했고, 화면·인증·서버·데이터베이스는 새로 구현했습니다. 공식 카카오 계정이나 서버에는 연결하지 않습니다.

## 실행

Node.js 22.13 이상과 npm이 필요합니다. 현재 PC에서는 Node 22.23.2로 검증했습니다.

```powershell
npm install
npm run desktop
```

PC 앱이 자체 로컬 서버를 시작합니다. 빌드 후 이미 설치된 의존성으로 다시 열 때는 `npx electron .`을 실행하면 됩니다.

Electron 45는 npm 패키지 설치와 실행 파일 다운로드가 분리되어 있습니다. `npm run desktop`과 `npm run desktop:dev`는 실행 전에 `desktop:install`을 자동 호출합니다. 최초 한 번 다운로드하며 같은 버전이 설치되어 있으면 재사용합니다.

브라우저로 실행하려면:

```powershell
npm run build
npm start
```

주소: [http://127.0.0.1:3001](http://127.0.0.1:3001). 개발 중에는 `npm run dev`로 [http://127.0.0.1:5173](http://127.0.0.1:5173)을 사용합니다. Electron 개발 모드는 `npm run desktop:dev`입니다. `dev`와 `desktop:dev`는 같은 포트를 사용하므로 동시에 실행하지 않습니다.

## 사용해 보기

로그인 화면의 예시 계정을 눌러 시작하거나 새 계정을 가입합니다. 예시 ID는 `young`, `jiyoon`, `minjun`, `soyeon`, 비밀번호는 모두 `demo1234`입니다. 예시 친구와 대화는 가상의 데이터입니다.

실시간 대화는 브라우저와 시크릿 창 등 **서로 쿠키를 공유하지 않는 두 창**에서 같은 서버 주소에 접속한 뒤 다른 계정으로 로그인하여 확인합니다. 일반 탭 두 개는 같은 로그인 세션을 공유합니다. PC 앱은 매 실행 시 임의 로컬 포트를 사용하므로 브라우저 테스트에는 `npm start` 실행을 권장합니다.

친구 탭에서 이름/ID 검색, 추가, 프로필, 별명, 즐겨찾기, 숨김, 차단, 삭제를 사용합니다. 숨김·차단은 친구 관리에서 복원합니다. 내 프로필에서 이름과 상태메시지를 수정하고 나와의 채팅을 열 수 있습니다.

채팅 탭에서 1:1 또는 여러 친구를 선택한 그룹 채팅을 만듭니다. Enter로 전송하고 Shift+Enter로 줄바꿈합니다. 실시간 수신, 안 읽은 수, 입력 중 표시, 이모지, 방 고정, 최신/안 읽은 순 정렬, 방·참여자 검색, 최근 200개 메시지 검색을 지원합니다. 알림 끄기는 앱 내부 수신 알림을 억제하며 OS 알림은 아직 지원하지 않습니다.

## 저장과 구조

- 브라우저 서버: `.data/katalk.sqlite` 및 SQLite WAL 파일.
- PC 앱: Electron 사용자 데이터 폴더 아래 `data/katalk.sqlite`. 브라우저 실행 데이터와 분리됩니다. `KATALK_DATA_DIR`로 위치를 지정할 수 있습니다.
- 입력 중인 초안: 계정·방별 브라우저 localStorage.
- `src/`: React + TypeScript 화면과 API 클라이언트.
- `server/`: Node HTTP, SQLite, scrypt 인증, HttpOnly 세션, SSE 실시간 이벤트.
- `desktop/`: Electron 셸, 자체 서버의 시작·정상 종료, 격리된 렌더러.
- `tests/`: HTTP 통합 테스트, 두 브라우저 계정으로 실행하는 UI 테스트.

의존성 버전은 `package-lock.json`에 고정되어 있습니다. 기존 설치를 재현하려면 `npm ci`를 사용합니다. SQLite 데이터와 실제 사용자 초안을 소스 관리에 추가하지 않습니다.

## 검증

```powershell
npm run build
npm test
npm run test:ui
npm run test:desktop
```

UI 테스트는 설치된 Chrome과 포트 3101을 사용하며 `test-results/ui-data` 아래 독립 데이터베이스를 만듭니다. Chrome이 없다면 설치된 브라우저에 맞춰 `playwright.config.ts`의 `channel`을 변경해야 합니다. 실제 실행 결과와 남은 작업은 [진행 기록](docs/PROGRESS.md)을 확인하세요.

## 현재 범위

이 버전은 같은 PC에서 동작하는 로컬 서비스입니다. 다른 PC 간 서비스 운영, 인터넷 배포, HTTPS, 계정 복구, 파일·사진 전송, 메시지 답장/삭제, 과거 메시지 페이지 로딩, 그룹 초대/권한, OS 알림, Windows 설치 파일 배포는 후속 범위입니다. 원본의 모든 기능이나 픽셀 단위 화면을 복원한 버전은 아닙니다.

원본과 다른 정책도 있습니다. 차단은 이 서비스에서 1:1 양방향 전송을 제한하고, 그룹 채팅 이름은 참가자에게 공유합니다. 이러한 독립 설계와 정적 근거를 [구현 범위](docs/implementation-scope.md)에 구분했습니다.

다음 요청에서 이어갈 때 [진행 기록](docs/PROGRESS.md), [역공학 기록](docs/reverse-engineering.md)을 먼저 읽으면 됩니다. 같은 설치본을 다시 분석하거나 전체 코드를 재탐색할 필요가 없습니다.
