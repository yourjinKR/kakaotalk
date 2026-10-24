# Messenger backend

This independent local messenger uses Express, Socket.IO, and Node's built-in SQLite. It does not connect to Kakao's services. Node 22.13 or newer is required.

`createApp({ dbPath, seed, staticDir })` returns `{ app, httpServer, io, close }`; callers choose the listening port and call `await close()` when finished. Running `node server/index.js` listens on `127.0.0.1:4100` and uses `data/talk.sqlite`.

The executable accepts `HOST` (loopback only), `PORT` (including `0` for an available port), `DB_PATH`, `STATIC_DIR`, and `SEED_DEMO=false`. Once listening, it prints `KAKAOTALK_SERVER_READY:{"port":4100}` with the actual port. Static frontend files are served when `STATIC_DIR/index.html` exists.

An empty database is seeded by default with `young`, `seoyeon`, and `minjun`, each with password `12345678`. These are local demonstration accounts. `seed: false` creates an empty database for tests or independent accounts.

## API

All responses are JSON. Errors have shape `{ error: "message" }`. All endpoints except health, registration, and login require `Authorization: Bearer <token>`. Sessions expire after 30 days. Passwords use salted scrypt; only SHA-256 hashes of session tokens are stored.

| Method | Path | Input / result |
| --- | --- | --- |
| GET | `/api/health` | `{ ok: true }` |
| POST | `/api/auth/register` | `{ handle, name, password, status? }` → `{ token, user }` |
| POST | `/api/auth/login` | `{ handle, password }` → `{ token, user }` |
| POST | `/api/auth/logout` | Revokes current token and its sockets; no body required |
| GET / PATCH | `/api/me` | Public user / `{ name?, status?, avatarColor? }` |
| GET | `/api/users?q=` | At most 30 public users matching literal name or handle, excluding self |
| GET / POST | `/api/friends` | Friend array / `{ handle }` → friend |
| PATCH | `/api/friends/:id` | `{ alias?, favorite?, hidden?, blocked? }` → friend |
| DELETE | `/api/friends/:id` | Removes this account's friend relation |
| GET / POST | `/api/rooms` | Room array / `{ memberIds, name? }` → room |
| PATCH | `/api/rooms/:id` | `{ pinned?, muted?, name? }` → room |
| DELETE | `/api/rooms/:id` | Leaves the room |
| GET | `/api/rooms/:id/messages?before=&q=` | `{ messages, hasMore }`, ascending; at most 60 messages |
| POST | `/api/rooms/:id/messages` | `{ text, clientId? }` → message |
| POST | `/api/rooms/:id/read` | Advances read cursor; no body required |

Public users have `{ id, handle, name, status, avatarColor }`. Friends add `{ alias, favorite, hidden, blocked }`. Rooms have `{ id, type, name, members, lastMessage, unreadCount, pinned, muted, updatedAt }`. Messages have `{ id, roomId, senderId, text, createdAt, unreadCount }`. IDs are integers and timestamps are ISO strings. A message's unread count is the number of other active members whose read cursor precedes it.

Handles contain 3–30 lowercase letters, digits, underscores, dots, or hyphens and start with a letter or digit. Passwords contain 8–128 characters. Names and aliases allow 30 characters, statuses 100, room names 50, and messages 5000. Avatar colors use six hexadecimal digits. A room supports up to 50 people.

`memberIds: []` creates or reuses self chat. One other member creates or reuses the unique direct chat; two or more create a group. Favorites, hidden state, aliases, pinned state, and muted state are per account. A group name is shared. Either person's block prevents direct messages and typing; group conversations are unaffected. Leaving a group revokes access. Leaving a direct chat hides it until a new message or room creation restores it, retaining history.

Authenticate Socket.IO with `auth: { token }`. The server emits `data:changed` for relevant accounts, `message:new` with the complete new message, and `typing` with `{ roomId, userId, isTyping }`. Clients may emit `typing` with `{ roomId, isTyping }`; membership and block state are checked, and an optional acknowledgement returns `{ ok, error? }`. Messaging writes use the HTTP API; repeated identical `clientId` values are idempotent for that sender.

`tests/server.test.js` uses temporary databases and actual HTTP/WebSocket connections to check authentication, friend state, authorization, group and direct chat, unread state, pagination, idempotency, events, and restart persistence.
