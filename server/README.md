# 카톡 로컬 서버

Node.js 22.13 이상에서 제공하는 `node:sqlite`를 사용합니다. 별도 데이터베이스나 서버 패키지가 필요하지 않습니다. 공식 카카오 서버에 연결하지 않는 독립 구현이며, 초기 데이터는 가상의 인물과 대화입니다.

```powershell
node server/index.mjs
node --test tests/backend.test.mjs
```

기본 주소는 `http://127.0.0.1:3001`, 데이터베이스는 `.data/katalk.sqlite`입니다. `PORT`(0이면 임의 포트), `HOST`, `DATA_DIR` 환경변수를 지원합니다. `dist/`가 있으면 화면 파일도 제공합니다. 서버 준비 시 표준 출력에 `{"type":"ready","url":"..."}`를 기록하고 IPC 연결이 있으면 같은 객체를 전송합니다. IPC `{type:'shutdown'}`, IPC 연결 해제, SIGINT/SIGTERM으로 정상 종료합니다.

초기 계정은 `young`(김영), `jiyoon`(이지윤), `minjun`(박민준), `soyeon`(한소연)이며 비밀번호는 모두 `demo1234`입니다. 새 계정은 회원가입으로 만듭니다. 비밀번호는 개별 salt와 scrypt로 저장하고, 세션 토큰은 SHA-256 해시로 저장합니다. 브라우저 세션 쿠키는 HttpOnly/SameSite=Lax이고 30일 후 만료됩니다. 로컬 실행용이므로 인터넷 공개 배포를 위해서는 HTTPS, 시도 횟수 제한, 운영용 계정 정책을 추가해야 합니다.

## API

모든 요청/응답은 JSON입니다. 인증 실패는 401, 다른 사용자의 방 접근은 404, 차단된 1:1 대화 전송은 403입니다. 오류 형식은 `{error:string}`입니다. `/api/me` 조회와 로그인/가입 외 API는 세션이 필요합니다.

| 메서드 / 경로 | 입력 | 응답 |
| --- | --- | --- |
| GET /api/me | — | `{user}` 또는 `{user:null}` |
| POST /api/auth/register | `{handle,name,password}` | `{user}` |
| POST /api/auth/login | `{handle,password}` | `{user}` |
| POST /api/auth/logout | — | `{ok:true}` |
| PATCH /api/me | `{name?,status?}` | `{user}` |
| GET /api/bootstrap | — | `{user,friends,rooms}` |
| GET /api/users?q= | 이름/아이디 부분 검색 | `{users}` |
| POST /api/friends | `{userId}` | `{friend}` |
| PATCH /api/friends/:id | `{favorite?,state?,alias?}` | `{friend}` |
| DELETE /api/friends/:id | — | `{ok:true}` |
| POST /api/rooms | `{memberIds:[],name?}` | `{room}` |
| PATCH /api/rooms/:id | `{name?,pinned?,muted?}` | `{room}` |
| DELETE /api/rooms/:id | — | `{ok:true}` (방 나가기) |
| GET /api/rooms/:id/messages?q= | 메시지 부분 검색 | `{messages}` |
| POST /api/rooms/:id/messages | `{text,clientId?}` | `{message}` |
| POST /api/rooms/:id/read | — | `{ok:true}` |
| POST /api/rooms/:id/typing | `{active:boolean}` | `{ok:true}` |
| GET /api/events | EventSource 연결 | SSE 데이터 |

사용자: `{id,handle,name,status,avatar,color}`. 친구는 여기에 `{favorite,state,alias}`가 추가됩니다. 친구 상태는 `normal`, `hidden`, `blocked`입니다. 친구 목록과 별명은 사용자별로 독립적입니다. 한쪽이 차단하면 기존 1:1 방을 포함하여 양쪽 모두 메시지 전송과 입력 상태 공유가 차단됩니다. 기존 기록 조회는 가능합니다. 단체 대화는 친구 차단과 별도로 동작합니다.

채팅방: `{id,name,type,members,lastMessage,unread,pinned,muted,updatedAt}`. 참여자가 없으면 나와의 채팅, 1명이면 1:1, 2명 이상이면 단체 방입니다. 같은 구성의 나와의 채팅/1:1 방은 기존 방을 재사용합니다. 고정/알림 끄기는 사용자별 설정이고 방 이름은 참여자에게 공유됩니다.

1:1 방 나가기는 나간 사용자의 목록과 이전 대화만 지웁니다. 상대에게는 원래 대화와 참여자 정보가 유지되고, 새 메시지를 보내면 나간 사용자의 목록에 방이 다시 표시됩니다. 다시 들어온 사용자는 나간 이후의 메시지만 조회·검색합니다. 상대가 방을 열기만 하는 경우에는 나간 사용자의 방이 복원되지 않습니다. 나간 상태에서는 메시지, 읽음, 입력 상태 및 방 설정 API에 접근할 수 없고 입력 중 이벤트도 전달되지 않습니다. 두 사람 모두 나가면 해당 방을 삭제합니다. 단체 방은 나간 사용자의 참여 자격을 제거합니다. 이전 버전 DB의 참여자 테이블은 시작 시 자동으로 보완하며 기존 대화를 유지합니다.

메시지: `{id,roomId,senderId,text,createdAt,unread}`. `unread`는 아직 읽지 않은 다른 참여자 수입니다. 메시지는 최대 4,000자, 조회는 최신 200개를 오래된 순서로 반환합니다. 같은 방/발신자의 동일한 `clientId` 전송은 중복 저장되지 않습니다. 방을 나가기 전에 보낸 메시지의 `clientId`를 다시 사용하면 409를 반환하여 지운 기록이 재노출되거나 재전송되지 않게 합니다. 읽기 호출은 현재 방의 마지막 메시지까지 읽음 처리합니다.

SSE 이벤트는 기본 `message` 이벤트의 JSON 데이터입니다. 관련 사용자의 데이터 변경 시 `{type:'sync'}`를 보내고, 입력 중 상태는 `{type:'typing',roomId,userId,active}`를 같은 방의 다른 참여자에게만 보냅니다. 25초 간격으로 연결 유지 주석을 보내며 로그아웃하면 해당 세션 연결을 종료합니다. 이벤트 전송 직전에도 세션 만료를 검사하여 만료된 연결로 데이터를 보내지 않습니다.

## 테스트용 생성

```js
import { createApp } from './server/index.mjs';
const app = createApp({ dbPath: ':memory:', seed: false });
app.server.listen(0, '127.0.0.1');
// app.server, app.db are available for integration tests.
await app.close();
```
