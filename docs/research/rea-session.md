# REA 실행 기록 — 2026-10-23

## 범위와 현재 결론

설치된 카카오톡 PC의 **친구 관리와 채팅**을 독립 구현하기 위한 읽기 전용 정적 조사다. 원본 프로그램 실행, 계정 데이터 조회, 네트워크 통신, 친구 변경, 메시지 전송은 수행하지 않았다. 원본 바이너리·아이콘·이미지를 프로젝트에 복사하지 않았다.

이번 REA 조사는 설치 실행 파일의 신원, PE 리소스 구조, managed/native 경계까지 확인했다. **친구 및 채팅의 실행 흐름을 이 결과만으로 확인했다고 주장할 수 없다.** 해당 기능의 배포 리소스 조사와 구현 설계는 다른 연구 문서와 함께 읽어야 한다.

## 대상 신원 — 확인된 사실

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 설치 파일 | `C:\Program Files (x86)\Kakao\KakaoTalk\KakaoTalk.exe` | 실제 파일 조회, 모든 아래 REA Evidence의 subject |
| 파일/제품 버전 | `26.9.0.5337` | PowerShell `Get-Item ... .VersionInfo` — REA Evidence와 구별되는 보조 관찰 |
| 제품/설명 | `KakaoTalk` / `KakaoTalk(32-bit)` | 동일 파일의 VersionInfo |
| 크기 | 25,430,632 bytes | REA PE·managed·artifact 결과 |
| SHA-256 | `23d0025988d3dd413801823657c5ac00e69945221d973aef7314f220142ab6a5` | REA 3종 결과 및 `Get-FileHash` 일치 |
| 형식 | PE32 / x86 / machine `0x014c` | REA PE 및 managed 결과 |
| PE 섹션 수 | 15 | REA managed 결과 |
| managed 판정 | `not-managed`, CLI data directory 없음 | REA managed 결과. CIL과 managed metadata를 이 파일에서 얻을 수 없음 |

## 실제 REA Evidence

### PE 리소스

- 파일: [rea-pe-resources.json](../evidence/rea-pe-resources.json)
- Evidence ID: `ev_9a4edcd6f1cc4950ab7e6b369c46b5d0280e35ec3939e46c09c573a3b8a9bb49`
- 작업: `inspect_pe_resources`, provider `rea-pe-resources` version `1`.
- 확인: resource directory RVA `43802624`, 원본 file offset `17075712`, 329,500 bytes. 디렉터리 entry 25개 검사, resource 10개, inventory coverage `complete`.
- type/name/language: `3/1..6/1042` 여섯 항목, `6/3841/1033`, `14/162/1042`, `16/1/1033`, `24/1/1033`.
- resource index 6의 string payload 범위: offset `17402184`, 130 bytes. **문자열 내용은 이 REA 작업에서 해독되지 않았다.**
- 제한: 아이콘 그룹 이외의 payload는 opaque이며 Windows의 실제 리소스 선택·렌더링·UI 동작을 관찰하지 않았다. type 6 항목 하나만 존재한다는 사실이 프로그램 전체의 문자열 또는 화면 수를 뜻하지 않는다.

### managed/native 경계

- 파일: [rea-managed-classification-complete-cache.json](../evidence/rea-managed-classification-complete-cache.json)
- Evidence ID: `ev_467663e8bc8a88e6fe610df11313181c09f80ea357c9e68d45fd3da8409fbcf0`
- 작업: `inspect_managed_artifact`, provider `rea-dotnet-static` version `1`.
- 확인: `cli-directory-absent`, metadata `absent`, CLI `null`, classification `not-managed`.
- 추론: 기능의 함수·분기·호출 관계를 조사할 다음 경로는 native provider다. 이 판정만으로 사용 언어, UI framework, 네트워크 protocol을 확정하지 않는다.

### artifact graph

- 파일: [rea-artifact-complete-cache.json](../evidence/rea-artifact-complete-cache.json)
- Evidence ID: `ev_a5c6817ff3a9f6cd97cf1daccb83b40b0c615733dbe55e2d962d6b7c7fcc3c24`
- 포함 inventory Evidence: `ev_13296c3a5f438d21332539de03dfdfaf863c2e5781d1a8e4a21168fabd69c78e`
- Manifest ID: `agm_b8a965a0046bdbcee3706b51864a8f3c79d36208476c1628745c61c8ad59f534`
- 확인: 선택한 EXE는 root node 1개, edge 0개인 PE artifact로 인벤토리화됨.
- 제한: 이 root inventory는 설치 폴더 전체나 EXE의 내부 기능 그래프를 분석한 결과가 아니다. `Artifact has no child container entries`는 조사한 컨테이너 경계 안의 결과다.

## 실행 환경과 복구 경로

- REA skill version `42`, CLI `6.7.0`, Node `22.23.2`, host `win32 x64`.
- 현재 에이전트의 도구 목록에 REA MCP 도구가 없었다.
- 먼저 권장 진단 명령 `npx -y rea-agents@6.7.0 doctor --client codex --json`을 시도했으나 npm registry DNS 조회가 `ENOTFOUND`로 실패했다. 전역 설치나 설정 변경 없이 기존 npm cache의 **공개 launcher**로 계속했다.
- 정상 launcher: `C:\Users\young\AppData\Local\npm-cache\_npx\af752b90495482d7\node_modules\.bin\rea.cmd`.
- 앞서 사용한 cache `a1722018f28f9df2`는 PE parser와 doctor는 작동했지만 artifact/managed 명령에서 `isexe` dependency 누락이 확인됐다. 그 실패 원문은 [rea-artifact.json](../evidence/rea-artifact.json), [rea-managed-classification.json](../evidence/rea-managed-classification.json)에 보존했다. 같은 호출을 반복하지 않고 완전한 다른 기존 cache로 전환했다.
- [rea-doctor-cached.json](../evidence/rea-doctor-cached.json): Codex 등록은 `aligned`, scoped health는 `true`, environment health는 `false`. 등록된 명령은 `cmd.exe /d /c npx -y rea-agents@6.7.0 mcp`. **등록 상태는 현재 세션 연결을 입증하지 않는다.** 설정을 다시 쓰는 작업은 필요하지 않았고 수행하지 않았다.
- [rea-capabilities.json](../evidence/rea-capabilities.json): Ghidra는 `GHIDRA_INSTALL_DIR` 미설정, IDA와 Kuna도 미설정, Hopper는 `unsupported_host`. native provider를 열지 않았으므로 닫을 native session도 없다.
- 같은 capabilities 결과에서 `observe_native_ui`와 `capture_native_ui_scenario`는 `native-macos` provider이며 Windows에서는 `unsupported_host`. **이번 Windows 원본 UI를 REA로 실측하지 않았다.**
- 기능 문구가 발견된 `skin\default\resource\string_merge.xml`을 `inspect-artifact`에 직접 전달했으나 `unsupported binary format`으로 거절됐다([원문](../evidence/rea-string-resource-artifact.json)). 이 파일의 정상 XML 해석·문구·line 번호는 [배포 리소스 조사](installed-resource-flows.md)의 일반 파일 관찰이며 REA가 XML 의미를 검증한 결과로 표현하지 않는다.
- 다른 클라이언트의 미등록 상태는 이번 Codex 작업의 복구 대상으로 삼지 않는다. 어떤 engine이나 prerequisite도 설치하지 않았다.

## 재현 명령

PowerShell에서 설치된 cache launcher가 여전히 존재하는지 먼저 확인한다. 아래는 원본 실행 없이 읽기 전용 분석을 재현한다. 증거가 이미 있고 대상 SHA-256이 같으면 같은 분석을 반복할 필요가 없다.

```powershell
$reaLauncher = 'C:\Users\young\AppData\Local\npm-cache\_npx\af752b90495482d7\node_modules\.bin\rea.cmd'
$kakaoBinary = 'C:\Program Files (x86)\Kakao\KakaoTalk\KakaoTalk.exe'
& $reaLauncher doctor --client codex --json
& $reaLauncher capabilities --json
& $reaLauncher inspect-pe-resources $kakaoBinary --json
& $reaLauncher inspect-managed-artifact $kakaoBinary --json
& $reaLauncher inspect-artifact $kakaoBinary --json
```

## 추가 확인 필요 / 다음 조사

후속 작업에서 별도 Windows computer-use로 메뉴·대화상자 진입과 취소까지 실제 관찰했다. 이미 확인한 진입 흐름은 [UI 관찰 원장](runtime-ui-observations.md)을 먼저 읽고 반복하지 않는다. 아래 완료 결과/송수신 상태 전이는 여전히 미확인이다.

1. 배포 리소스의 친구/채팅 관련 키와 문구가 어떤 화면·상태와 연결되는지 조사한다. 문자열 존재와 실행 순서는 구별한다.
2. 친구 검색·추가·숨김/차단/삭제의 정확한 진입점, 확인 대화상자, 결과 상태를 Windows UI에서 관찰해야 한다. 현재 REA UI provider로는 지원되지 않는다.
3. 1:1 및 그룹 생성 흐름, 전송 중/실패/수신/읽음 상태의 실제 전이를 확인해야 한다. 이번 Evidence는 전송 protocol이나 server 처리 규칙을 밝히지 않는다.
4. 함수/xref 분석이 필요한 구체적인 질문이 생긴 뒤에만 사용자가 제공한 기존 Ghidra/IDA/Kuna 환경을 선택한다. 설치·환경 설정 변경은 별도 범위다.
5. 독립 구현에는 원본 자산이나 복원 코드를 사용하지 않는다. 위 미확인 동작은 프로젝트의 **설계 선택**으로 명시하고 검증 가능한 최소 동작부터 진행한다.
