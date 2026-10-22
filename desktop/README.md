# 카톡 데스크톱 실행

프로젝트 루트에서 의존성을 설치한 뒤 실행합니다.

```powershell
npm install
npm run desktop
```

`desktop` 스크립트는 웹 화면을 빌드한 뒤 Electron을 실행합니다. Electron은 자신의 Node 런타임으로 `server/index.mjs`를 별도 실행하고, 할당된 로컬 포트의 앱을 창에 표시합니다. 앱을 닫으면 자신이 실행한 서버도 종료합니다. 이 단계는 로컬 개발 실행이며 Windows 설치 파일 생성은 포함하지 않습니다.

화면 개발 시에는 다음 명령으로 Vite의 자동 갱신을 사용합니다.

```powershell
npm run desktop:dev
```

개발 실행은 Vite의 `127.0.0.1:5173`과 API의 `127.0.0.1:3001`을 사용합니다. 해당 포트를 사용하는 기존 개발 서버를 먼저 종료해야 합니다. 일반 데스크톱 실행은 빈 포트를 자동 할당합니다.

## 데이터

데스크톱의 데이터는 Electron `app.getPath('userData')` 아래 `data` 폴더에 저장됩니다. Windows에서는 일반적으로 `%APPDATA%\카톡\data`입니다. 웹 개발용 작업 폴더의 데이터와 별도로 유지됩니다. 직접 경로를 지정하려면 다음과 같이 실행합니다.

```powershell
$env:KATALK_DATA_DIR = 'C:\my-katalk-data'
npm run desktop
```

## 실행 계약

- 루트 `package.json`의 `main`은 `desktop/main.cjs`입니다.
- `desktop`: `npm run build && electron .`
- `desktop:dev`: `node scripts/desktop-dev.mjs`
- Electron의 Node 런타임은 `node:sqlite`의 `DatabaseSync`를 지원해야 합니다.
- 서버는 `HOST`, `PORT`, `DATA_DIR`을 사용하고, 시작 후 IPC로 `{ type: 'ready', url }`을 보냅니다.
- 서버는 IPC `{ type: 'shutdown' }`을 받으면 요청 수신과 데이터베이스를 종료합니다.
- 일반 실행에서 서버는 빌드된 `dist`를 제공하고, 개발 실행에서 Vite는 `/api`를 3001 포트로 프록시합니다.

렌더러는 Node API를 사용할 수 없고 샌드박스와 컨텍스트 분리를 적용합니다. 외부 페이지 이동, 새 창, 브라우저 권한 요청은 기본으로 차단합니다.
