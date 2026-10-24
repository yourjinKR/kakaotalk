# KakaoTalk PC 친구·채팅 재현 근거

이 디렉터리는 설치된 PC 클라이언트의 정적 관찰을 다음 개발 세션에서 재사용하기 위한 기록이다. 설치 앱을 실행하거나 계정·친구 목록·대화 데이터베이스를 열지 않았다. 제품 로고, 아이콘, 사진, 이모티콘 등의 이미지 파일은 복사하지 않았다.

## 조사 대상

- 경로: `C:\Program Files (x86)\Kakao\KakaoTalk\KakaoTalk.exe`
- 파일 버전: `26.9.0.5337`
- 크기: `25,430,632` bytes
- SHA-256: `23d0025988d3dd413801823657c5ac00e69945221d973aef7314f220142ab6a5`
- 조사일: `2026-10-24` (Asia/Seoul)

설치 버전의 내용에 대한 조사다. 서버 동작, 현재 로그인 계정, 활성화된 기능 및 최신 배포 버전은 확인하지 않았다.

## 보존한 자료

| 파일 | 성격 |
| --- | --- |
| [findings.md](findings.md) | 기능별 관찰, 구현 시 추론, 불확실성 및 다음 조사 항목 |
| [evidence/rea-pe-resources.json](evidence/rea-pe-resources.json) | 실제 REA CLI가 반환한 완전한 PE 리소스 Evidence |
| [evidence/artifact-identities.json](evidence/artifact-identities.json) | 일반 PowerShell로 수집한 대상 파일 22개의 경로·크기·SHA-256·앞 32 bytes |
| [evidence/selected-korean-strings.json](evidence/selected-korean-strings.json) | 일반 PowerShell로 수집한 선택적 문자열·문자열 ID·원본 행 번호 |
| [evidence/color-tokens.json](evidence/color-tokens.json) | 읽을 수 있는 설치 색상 XML의 솔리드 토큰 |
| [evidence/collection-manifest.json](evidence/collection-manifest.json) | 일반 정적 수집 범위와 실행 시각 |
| [evidence/rea-readiness-summary.json](evidence/rea-readiness-summary.json) | 실제 doctor 출력에서 요약한 연결 상태; REA Evidence가 아님 |

REA Evidence ID는 `ev_9a4edcd6f1cc4950ab7e6b369c46b5d0280e35ec3939e46c09c573a3b8a9bb49`이다. 이 ID가 증명하는 범위는 실행 파일의 PE 리소스 트리뿐이다. 친구·채팅 기능 설명의 근거는 별도로 명시한 설치 문자열이며, 그 문자열을 REA 분석 결과로 포장하지 않는다.

## 재수집

워크스페이스에서 다음 명령을 실행하면 선택한 공개 설치 파일만 다시 읽는다.

```powershell
.\scripts\research\collect-installed-evidence.ps1
```

설치 앱이 업데이트되면 기존 해시와 비교한 후 새 버전의 관찰을 별도 기록한다. 이 스크립트는 설치 디렉터리에 쓰지 않는다. 현재 근거는 UI 리소스의 존재를 확인하며, 실제 화면 배치나 네이티브 함수 실행을 확인하지 않는다.
