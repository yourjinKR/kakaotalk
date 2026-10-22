import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 32 * 1024;
const COLORS = ['#e9b1ad', '#a8c7ba', '#acc4e1', '#d0b8dc', '#e5ca9b', '#adc8cf'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function text(value, label, max, { empty = false } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${label}을(를) 입력해 주세요.`);
  const result = value.trim();
  if ((!empty && !result) || result.length > max) throw new HttpError(400, `${label}은(는) ${empty ? 0 : 1}~${max}자여야 합니다.`);
  return result;
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, '올바른 JSON 요청이 필요합니다.'); }
}

function initialize(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, handle TEXT UNIQUE COLLATE NOCASE NOT NULL,
      name TEXT NOT NULL, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '', color TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friends (
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      favorite INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'normal', alias TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (owner_id, user_id), CHECK(owner_id != user_id), CHECK(state IN ('normal','hidden','blocked'))
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(type IN ('self','direct','group'))
    );
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_id INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, visible_after_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, created_at TEXT NOT NULL, client_id TEXT,
      UNIQUE(room_id, sender_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS messages_room_id ON messages(room_id, id);
    CREATE INDEX IF NOT EXISTS memberships_user_id ON room_members(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  const memberColumns = db.prepare('PRAGMA table_info(room_members)').all().map(column => column.name);
  if (!memberColumns.includes('active')) db.exec('ALTER TABLE room_members ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  if (!memberColumns.includes('visible_after_id')) db.exec('ALTER TABLE room_members ADD COLUMN visible_after_id INTEGER NOT NULL DEFAULT 0');
}

function seedDatabase(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) return;
  const demos = [
    ['young', '김영', '오늘도 즐거운 하루 ☀️', COLORS[0]],
    ['jiyoon', '이지윤', '작은 순간을 소중하게 🌿', COLORS[1]],
    ['minjun', '박민준', '차근차근, 한 걸음씩', COLORS[2]],
    ['soyeon', '한소연', '좋아하는 것들로 가득히', COLORS[3]],
  ];
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const [handle, name, status, color] of demos) {
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(`demo-${handle}`, handle, name, passwordHash('demo1234'), status, name.at(-1), color, new Date(now).toISOString());
    }
    for (const [owner] of demos) for (const [target] of demos) if (owner !== target) {
      db.prepare('INSERT INTO friends(owner_id,user_id,favorite) VALUES(?,?,?)').run(`demo-${owner}`, `demo-${target}`, target === 'jiyoon' ? 1 : 0);
    }
    const addRoom = (id, name, type, handles, entries, unread = false) => {
      const lastTime = new Date(now - 60_000).toISOString();
      db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run(id, name, type, new Date(now - 86_400_000).toISOString(), lastTime);
      for (const handle of handles) db.prepare('INSERT INTO room_members(room_id,user_id,pinned) VALUES(?,?,?)').run(id, `demo-${handle}`, type === 'group' ? 1 : 0);
      let lastId = 0;
      entries.forEach(([sender, content], i) => {
        const at = new Date(now - (entries.length - i) * 3_600_000).toISOString();
        lastId = Number(db.prepare('INSERT INTO messages(room_id,sender_id,text,created_at) VALUES(?,?,?,?)').run(id, `demo-${sender}`, content, at).lastInsertRowid);
        db.prepare('UPDATE rooms SET updated_at=? WHERE id=?').run(at, id);
      });
      db.prepare('UPDATE room_members SET last_read_id=? WHERE room_id=?').run(lastId, id);
      if (unread) db.prepare('UPDATE room_members SET last_read_id=? WHERE room_id=? AND user_id=?').run(Math.max(0, lastId - 1), id, 'demo-young');
    };
    addRoom('demo-direct-jiyoon', '', 'direct', ['young', 'jiyoon'], [
      ['jiyoon', '영아, 주말에 시간 있어? 😊'], ['young', '응! 토요일 오후 어때?'],
      ['jiyoon', '좋아! 새로 생긴 카페 가보자 ☕'], ['jiyoon', '사진 보니까 분위기가 정말 좋더라!'],
    ], true);
    addRoom('demo-direct-minjun', '', 'direct', ['young', 'minjun'], [
      ['young', '민준아, 어제 추천해 준 음악 잘 들었어 🎧'], ['minjun', '마음에 들었다니 다행이다! 다음에 또 추천해 줄게.'],
    ]);
    addRoom('demo-weekend', '우리의 주말 🌼', 'group', ['young', 'jiyoon', 'minjun', 'soyeon'], [
      ['soyeon', '이번 주말에는 다 같이 산책 어때요? 🌳'], ['minjun', '좋아요! 날씨도 좋다던데'],
      ['young', '저도 좋아요 🙌'], ['jiyoon', '토요일 2시, 공원 입구에서 만나요!'],
    ], true);
    addRoom('demo-self-young', '나와의 채팅', 'self', ['young'], [['young', '나에게 남기는 작은 메모 📝\n생각나는 일이나 기억하고 싶은 내용을 여기에 저장해 보세요.']]);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Creates an isolated HTTP application. Call server.listen(), then await close(). */
export function createApp({ dbPath = resolve(process.env.DATA_DIR || resolve(projectRoot, '.data'), 'katalk.sqlite'), seed = true, distPath = resolve(projectRoot, 'dist') } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  initialize(db);
  if (seed) seedDatabase(db);
  const connections = new Map();
  const userFields = (row) => ({ id: row.id, handle: row.handle, name: row.name, status: row.status, avatar: row.avatar, color: row.color });
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const roomUsers = (id, activeOnly = false) => db.prepare(`SELECT user_id FROM room_members WHERE room_id=?${activeOnly ? ' AND active=1' : ''}`).all(id).map(row => row.user_id);
  const notify = (ids, event = { type: 'sync' }) => {
    for (const id of new Set(ids)) for (const connection of connections.get(id) || []) {
      if (connection.res.destroyed || connection.res.writableEnded) continue;
      const valid = db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(connection.tokenHash, Date.now());
      if (!valid) connection.res.end();
      else connection.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
  const getSession = (req) => {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('katalk_session='))?.slice(15);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = db.prepare('SELECT users.*, sessions.token_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(tokenHash, Date.now());
    return row || null;
  };
  const setSession = (res, id) => {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'), id, Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', `katalk_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`);
  };
  const member = (roomId, userId) => {
    const result = db.prepare('SELECT rooms.*, room_members.last_read_id,room_members.pinned,room_members.muted,room_members.visible_after_id FROM rooms JOIN room_members ON rooms.id=room_members.room_id WHERE rooms.id=? AND room_members.user_id=? AND room_members.active=1').get(roomId, userId);
    if (!result) throw new HttpError(404, '대화방을 찾을 수 없습니다.');
    return result;
  };
  const isBlocked = (a, b) => !!db.prepare("SELECT 1 FROM friends WHERE ((owner_id=? AND user_id=?) OR (owner_id=? AND user_id=?)) AND state='blocked'").get(a, b, b, a);
  const checkDirectBlock = (room, userId) => {
    if (room.type !== 'direct') return;
    const other = roomUsers(room.id).find(id => id !== userId);
    if (other && isBlocked(userId, other)) throw new HttpError(403, '차단된 사용자와는 메시지를 주고받을 수 없습니다.');
  };
  const serializeRoom = (roomId, userId) => {
    const row = member(roomId, userId);
    const members = db.prepare('SELECT users.* FROM users JOIN room_members ON users.id=room_members.user_id WHERE room_members.room_id=? ORDER BY users.name,users.id').all(roomId).map(userFields);
    const last = db.prepare('SELECT text,created_at,sender_id FROM messages WHERE room_id=? AND id>? ORDER BY id DESC LIMIT 1').get(roomId, row.visible_after_id);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE room_id=? AND id>? AND sender_id!=?').get(roomId, row.last_read_id, userId).n;
    return { id: row.id, name: row.name || (row.type === 'self' ? '나와의 채팅' : members.filter(user => user.id !== userId).map(user => user.name).join(', ')), type: row.type, members, lastMessage: last ? { text: last.text, createdAt: last.created_at, senderId: last.sender_id } : null, unread, pinned: !!row.pinned, muted: !!row.muted, updatedAt: row.updated_at };
  };
  const serializeMessage = (row) => ({ id: row.id, roomId: row.room_id, senderId: row.sender_id, text: row.text, createdAt: row.created_at, unread: db.prepare('SELECT COUNT(*) AS n FROM room_members WHERE room_id=? AND user_id!=? AND active=1 AND last_read_id<? AND visible_after_id<?').get(row.room_id, row.sender_id, row.id, row.id).n });
  const friendList = (id) => db.prepare('SELECT users.*,friends.favorite,friends.state,friends.alias FROM friends JOIN users ON users.id=friends.user_id WHERE friends.owner_id=? ORDER BY friends.favorite DESC,users.name,users.id').all(id).map(row => ({ ...userFields(row), favorite: !!row.favorite, state: row.state, alias: row.alias }));
  const roomList = (id) => db.prepare('SELECT rooms.id FROM rooms JOIN room_members ON rooms.id=room_members.room_id WHERE room_members.user_id=? AND room_members.active=1 ORDER BY room_members.pinned DESC, rooms.updated_at DESC, rooms.id').all(id).map(row => serializeRoom(row.id, id));
  const closeUserSessionEvents = (userId, hash) => {
    for (const connection of connections.get(userId) || []) if (connection.tokenHash === hash) connection.res.end();
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(method) && req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, '허용되지 않은 요청입니다.'); }
        const requestHost = (req.headers.host || '').split(':')[0];
        if (origin.hostname !== requestHost && !(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && ['localhost', '127.0.0.1', '[::1]'].includes(requestHost))) throw new HttpError(403, '허용되지 않은 요청입니다.');
      }
      const session = path.startsWith('/api/') ? getSession(req) : null;
      if (path === '/api/me' && method === 'GET') return send(res, 200, { user: session ? userFields(session) : null });
      if (path === '/api/auth/login' && method === 'POST') {
        const input = await body(req);
        const handle = text(input.handle, '아이디', 30).toLowerCase();
        const password = text(input.password, '비밀번호', 200);
        const user = db.prepare('SELECT * FROM users WHERE handle=?').get(handle);
        // Use a real scrypt computation even for unknown handles.
        const valid = passwordMatches(password, user?.password_hash || '00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
        if (!user || !valid) throw new HttpError(401, '아이디 또는 비밀번호를 확인해 주세요.');
        setSession(res, user.id);
        return send(res, 200, { user: userFields(user) });
      }
      if (path === '/api/auth/register' && method === 'POST') {
        const input = await body(req);
        const handle = text(input.handle, '아이디', 30).toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(handle)) throw new HttpError(400, '아이디는 영문, 숫자, 밑줄 3~30자로 입력해 주세요.');
        const name = text(input.name, '이름', 40);
        const password = text(input.password, '비밀번호', 200);
        if (password.length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.');
        if (db.prepare('SELECT 1 FROM users WHERE handle=?').get(handle)) throw new HttpError(409, '이미 사용 중인 아이디입니다.');
        const id = randomUUID();
        db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(id, handle, name, passwordHash(password), '', name.at(-1), COLORS[randomBytes(1)[0] % COLORS.length], new Date().toISOString());
        setSession(res, id);
        return send(res, 201, { user: userFields(getUser(id)) });
      }
      if (path.startsWith('/api/') && !session) throw new HttpError(401, '로그인이 필요합니다.');
      const userId = session?.id;
      const authenticatedBody = async () => {
        const input = await body(req);
        if (!getSession(req)) throw new HttpError(401, '로그인이 필요합니다.');
        return input;
      };
      if (path === '/api/auth/logout' && method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
        closeUserSessionEvents(userId, session.token_hash);
        res.setHeader('Set-Cookie', 'katalk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        return send(res, 200, { ok: true });
      }
      if (path === '/api/bootstrap' && method === 'GET') return send(res, 200, { user: userFields(session), friends: friendList(userId), rooms: roomList(userId) });
      if (path === '/api/me' && method === 'PATCH') {
        const input = await authenticatedBody();
        const currentUser = getUser(userId);
        const name = input.name === undefined ? currentUser.name : text(input.name, '이름', 40);
        const status = input.status === undefined ? currentUser.status : text(input.status, '상태 메시지', 140, { empty: true });
        db.prepare('UPDATE users SET name=?,status=?,avatar=? WHERE id=?').run(name, status, name.at(-1), userId);
        const related = db.prepare('SELECT owner_id AS id FROM friends WHERE user_id=? UNION SELECT user_id AS id FROM room_members WHERE room_id IN (SELECT room_id FROM room_members WHERE user_id=?)').all(userId, userId).map(row => row.id);
        notify([userId, ...related]);
        return send(res, 200, { user: userFields(getUser(userId)) });
      }
      if (path === '/api/users' && method === 'GET') {
        const query = (url.searchParams.get('q') || '').trim().slice(0, 100).replace(/[!%_]/g, match => `!${match}`);
        const users = query ? db.prepare("SELECT * FROM users WHERE id!=? AND (name LIKE ? ESCAPE '!' OR handle LIKE ? ESCAPE '!') ORDER BY name LIMIT 50").all(userId, `%${query}%`, `%${query}%`).map(userFields) : [];
        return send(res, 200, { users });
      }
      if (path === '/api/friends' && method === 'POST') {
        const input = await authenticatedBody();
        const target = text(input.userId, '사용자', 100);
        if (target === userId) throw new HttpError(400, '나 자신은 친구로 추가할 수 없습니다.');
        if (!getUser(target)) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
        db.prepare('INSERT INTO friends(owner_id,user_id) VALUES(?,?) ON CONFLICT(owner_id,user_id) DO NOTHING').run(userId, target);
        notify([userId]);
        return send(res, 200, { friend: friendList(userId).find(friend => friend.id === target) });
      }
      const friendMatch = path.match(/^\/api\/friends\/([^/]+)$/);
      if (friendMatch && ['PATCH', 'DELETE'].includes(method)) {
        const target = decodeURIComponent(friendMatch[1]);
        let row = db.prepare('SELECT * FROM friends WHERE owner_id=? AND user_id=?').get(userId, target);
        if (!row) throw new HttpError(404, '친구를 찾을 수 없습니다.');
        if (method === 'DELETE') {
          db.prepare('DELETE FROM friends WHERE owner_id=? AND user_id=?').run(userId, target);
          notify([userId]);
          return send(res, 200, { ok: true });
        }
        const input = await authenticatedBody();
        row = db.prepare('SELECT * FROM friends WHERE owner_id=? AND user_id=?').get(userId, target);
        if (!row) throw new HttpError(404, '친구를 찾을 수 없습니다.');
        if (input.favorite !== undefined && typeof input.favorite !== 'boolean') throw new HttpError(400, '즐겨찾기 값이 올바르지 않습니다.');
        if (input.state !== undefined && !['normal', 'hidden', 'blocked'].includes(input.state)) throw new HttpError(400, '친구 상태가 올바르지 않습니다.');
        const alias = input.alias === undefined ? row.alias : text(input.alias, '친구 이름', 40, { empty: true });
        db.prepare('UPDATE friends SET favorite=?,state=?,alias=? WHERE owner_id=? AND user_id=?').run(input.favorite === undefined ? row.favorite : Number(input.favorite), input.state ?? row.state, alias, userId, target);
        notify([userId]);
        return send(res, 200, { friend: friendList(userId).find(friend => friend.id === target) });
      }
      if (path === '/api/rooms' && method === 'POST') {
        const input = await authenticatedBody();
        if (!Array.isArray(input.memberIds) || input.memberIds.length > 50 || input.memberIds.some(id => typeof id !== 'string')) throw new HttpError(400, '참여자를 50명 이내로 선택해 주세요.');
        const others = [...new Set(input.memberIds)].filter(id => id !== userId);
        const ids = [userId, ...others];
        for (const id of others) if (!getUser(id)) throw new HttpError(404, '참여자를 찾을 수 없습니다.');
        const type = others.length === 0 ? 'self' : others.length === 1 ? 'direct' : 'group';
        if (type === 'direct' && isBlocked(userId, others[0])) throw new HttpError(403, '차단된 사용자와는 대화할 수 없습니다.');
        const name = input.name === undefined ? '' : text(input.name, '채팅방 이름', 80, { empty: true });
        if (type !== 'group') {
          const existing = db.prepare('SELECT rooms.id FROM rooms JOIN room_members ON rooms.id=room_members.room_id WHERE room_members.user_id=? AND rooms.type=?').all(userId, type).find(row => {
            const members = roomUsers(row.id);
            return members.length === ids.length && ids.every(id => members.includes(id));
          });
          if (existing) {
            db.prepare('UPDATE room_members SET active=1 WHERE room_id=? AND user_id=?').run(existing.id, userId);
            notify([userId]);
            return send(res, 200, { room: serializeRoom(existing.id, userId) });
          }
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        db.exec('BEGIN');
        try {
          db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run(id, name, type, now, now);
          for (const memberId of ids) db.prepare('INSERT INTO room_members(room_id,user_id) VALUES(?,?)').run(id, memberId);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        notify(ids);
        return send(res, 201, { room: serializeRoom(id, userId) });
      }
      const roomMatch = path.match(/^\/api\/rooms\/([^/]+)(?:\/(messages|read|typing))?$/);
      if (roomMatch) {
        const roomId = decodeURIComponent(roomMatch[1]);
        const action = roomMatch[2];
        let room = member(roomId, userId);
        if (!action && method === 'PATCH') {
          const input = await authenticatedBody();
          room = member(roomId, userId);
          for (const key of ['pinned', 'muted']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new HttpError(400, '채팅방 설정이 올바르지 않습니다.');
          if (input.name !== undefined) db.prepare('UPDATE rooms SET name=? WHERE id=?').run(text(input.name, '채팅방 이름', 80, { empty: true }), roomId);
          db.prepare('UPDATE room_members SET pinned=?,muted=? WHERE room_id=? AND user_id=?').run(input.pinned === undefined ? room.pinned : Number(input.pinned), input.muted === undefined ? room.muted : Number(input.muted), roomId, userId);
          notify(input.name !== undefined ? roomUsers(roomId) : [userId]);
          return send(res, 200, { room: serializeRoom(roomId, userId) });
        }
        if (!action && method === 'DELETE') {
          const affected = roomUsers(roomId);
          if (room.type === 'direct') {
            const latest = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE room_id=?').get(roomId).id;
            db.prepare('UPDATE room_members SET active=0,visible_after_id=?,last_read_id=?,pinned=0 WHERE room_id=? AND user_id=?').run(latest, latest, roomId, userId);
          } else db.prepare('DELETE FROM room_members WHERE room_id=? AND user_id=?').run(roomId, userId);
          if (!roomUsers(roomId, true).length) db.prepare('DELETE FROM rooms WHERE id=?').run(roomId);
          notify(affected);
          return send(res, 200, { ok: true });
        }
        if (action === 'messages' && method === 'GET') {
          const query = (url.searchParams.get('q') || '').trim().slice(0, 200).replace(/[!%_]/g, match => `!${match}`);
          const rows = query ? db.prepare("SELECT * FROM messages WHERE room_id=? AND id>? AND text LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT 200").all(roomId, room.visible_after_id, `%${query}%`) : db.prepare('SELECT * FROM messages WHERE room_id=? AND id>? ORDER BY id DESC LIMIT 200').all(roomId, room.visible_after_id);
          return send(res, 200, { messages: rows.reverse().map(serializeMessage) });
        }
        if (action === 'messages' && method === 'POST') {
          const input = await authenticatedBody();
          room = member(roomId, userId);
          checkDirectBlock(room, userId);
          const content = text(input.text, '메시지', 4000);
          const clientId = input.clientId == null ? null : text(input.clientId, '메시지 식별자', 100);
          if (clientId) {
            const existing = db.prepare('SELECT * FROM messages WHERE room_id=? AND sender_id=? AND client_id=?').get(roomId, userId, clientId);
            if (existing) {
              if (existing.id <= room.visible_after_id) throw new HttpError(409, '나가기 전에 보낸 메시지는 다시 전송할 수 없습니다. 새 메시지로 보내 주세요.');
              return send(res, 200, { message: serializeMessage(existing) });
            }
          }
          const now = new Date().toISOString();
          db.exec('BEGIN');
          let id;
          try {
            id = Number(db.prepare('INSERT INTO messages(room_id,sender_id,text,created_at,client_id) VALUES(?,?,?,?,?)').run(roomId, userId, content, now, clientId).lastInsertRowid);
            db.prepare('UPDATE rooms SET updated_at=? WHERE id=?').run(now, roomId);
            db.prepare('UPDATE room_members SET last_read_id=? WHERE room_id=? AND user_id=?').run(id, roomId, userId);
            if (room.type === 'direct') db.prepare('UPDATE room_members SET active=1 WHERE room_id=?').run(roomId);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          notify(roomUsers(roomId));
          return send(res, 201, { message: serializeMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(id)) });
        }
        if (action === 'read' && method === 'POST') {
          const latest = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE room_id=?').get(roomId).id;
          if (latest > room.last_read_id) {
            db.prepare('UPDATE room_members SET last_read_id=? WHERE room_id=? AND user_id=?').run(latest, roomId, userId);
            notify(roomUsers(roomId));
          }
          return send(res, 200, { ok: true });
        }
        if (action === 'typing' && method === 'POST') {
          const input = await authenticatedBody();
          room = member(roomId, userId);
          checkDirectBlock(room, userId);
          if (typeof input.active !== 'boolean') throw new HttpError(400, '입력 상태가 올바르지 않습니다.');
          notify(roomUsers(roomId, true).filter(id => id !== userId), { type: 'typing', roomId, userId, active: input.active });
          return send(res, 200, { ok: true });
        }
      }
      if (path === '/api/events' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        if (!connections.has(userId)) connections.set(userId, new Set());
        const connection = { res, tokenHash: session.token_hash };
        connections.get(userId).add(connection);
        const heartbeat = setInterval(() => {
          const exists = db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(session.token_hash, Date.now());
          if (!exists) res.end(); else res.write(': heartbeat\n\n');
        }, 25_000);
        heartbeat.unref();
        res.on('close', () => {
          clearInterval(heartbeat);
          connections.get(userId)?.delete(connection);
          if (connections.get(userId)?.size === 0) connections.delete(userId);
        });
        return;
      }
      if (path.startsWith('/api/')) throw new HttpError(404, '요청한 API를 찾을 수 없습니다.');
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '허용되지 않은 요청입니다.');
      const base = resolve(distPath);
      const decoded = decodeURIComponent(path);
      const candidate = resolve(base, `.${decoded}`);
      if (candidate !== base && !candidate.startsWith(base + sep)) throw new HttpError(403, '잘못된 경로입니다.');
      let file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(base, 'index.html');
      if (!existsSync(file)) return send(res, 404, { error: '화면이 아직 빌드되지 않았습니다. npm run dev 또는 npm run build를 실행해 주세요.' });
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      if (method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!error.status) console.error('[katalk]', error);
      send(res, error.status || 500, { error: error.status ? error.message : '처리 중 오류가 발생했습니다.' });
    }
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const entries of connections.values()) for (const { res } of entries) res.end();
    await new Promise((resolveClose, reject) => {
      if (!server.listening) return resolveClose();
      server.close(error => error ? reject(error) : resolveClose());
      server.closeIdleConnections();
    });
    db.close();
  };
  return { server, close, db };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => {
    const address = app.server.address();
    const url = `http://${host}:${address.port}`;
    console.log(JSON.stringify({ type: 'ready', url }));
    process.send?.({ type: 'ready', url });
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => app.close().then(() => process.exit(0)));
  process.on('message', message => { if (message?.type === 'shutdown') app.close().then(() => process.exit(0)); });
  process.once('disconnect', () => app.close().then(() => process.exit(0)));
}
