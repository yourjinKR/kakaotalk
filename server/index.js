import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { openDatabase, transaction } from './database.js';

const deriveKey = promisify(scrypt);
const SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const COLORS = ['#7589DE', '#ECAD95', '#85B8A8', '#B99AD6', '#DCA36A'];
const publicUser = (row) => ({ id: row.id, handle: row.handle, name: row.name, status: row.status, avatarColor: row.avatar_color });
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function stringValue(value, label, { min = 0, max = 100, trim = true } = {}) {
  if (typeof value !== 'string') throw fail(400, `${label}을(를) 확인해 주세요.`);
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) throw fail(400, `${label}은(는) ${min}~${max}자로 입력해 주세요.`);
  return result;
}

function idValue(value) {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(number)) throw fail(400, '올바른 ID가 필요합니다.');
  return number;
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') throw fail(400, `${label}은(는) true 또는 false여야 합니다.`);
  return Number(value);
}

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

export function createApp({ dbPath = resolve('data/talk.sqlite'), seed = true, staticDir } = {}) {
  const db = openDatabase(dbPath, { seed });
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    cors: { origin(origin, callback) {
      if (!origin) return callback(null, true);
      try { callback(null, ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)); }
      catch { callback(null, false); }
    } },
  });
  const rateWindows = new Map();
  let closed = false;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (req.body === undefined && (req.path === '/auth/logout' || /^\/rooms\/[1-9]\d*\/read$/.test(req.path))) req.body = {};
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body))) {
      return next(fail(400, 'JSON 객체를 보내 주세요.'));
    }
    next();
  });

  function rateLimit(key, max, interval) {
    const now = Date.now();
    let entry = rateWindows.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + interval };
      rateWindows.set(key, entry);
    }
    entry.count += 1;
    if (rateWindows.size > 10000) for (const [k, v] of rateWindows) if (v.reset < now) rateWindows.delete(k);
    if (entry.count > max) throw fail(429, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }

  function sessionForToken(token) {
    if (typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]+$/.test(token)) return null;
    return db.prepare('SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(tokenHash(token), Date.now());
  }

  function issueSession(user) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), user.id, Date.now() + SESSION_LIFETIME);
    return { token, user: publicUser(user) };
  }

  function authenticate(req, _res, next) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('Authorization') || '');
    const user = match && sessionForToken(match[1]);
    if (!user) return next(fail(401, '로그인이 필요합니다.'));
    req.user = user;
    req.sessionHash = user.token_hash;
    next();
  }

  function changed(userIds, reason, roomId) {
    for (const id of new Set(userIds)) io.to(`user:${id}`).emit('data:changed', { reason, ...(roomId ? { roomId } : {}) });
  }

  function roomMembers(roomId, activeOnly = true) {
    return db.prepare(`SELECT u.*, m.read_message_id, m.active FROM members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ${activeOnly ? 'AND m.active = 1' : ''} ORDER BY u.id`).all(roomId);
  }

  function requireRoom(roomId, userId) {
    const row = db.prepare('SELECT r.*, m.read_message_id, m.pinned, m.muted FROM rooms r JOIN members m ON m.room_id = r.id WHERE r.id = ? AND m.user_id = ? AND m.active = 1').get(roomId, userId);
    if (!row) throw fail(404, '채팅방을 찾을 수 없습니다.');
    return row;
  }

  function blockedBetween(first, second) {
    return !!db.prepare('SELECT 1 FROM friends WHERE blocked = 1 AND ((owner_id = ? AND friend_id = ?) OR (owner_id = ? AND friend_id = ?))').get(first, second, second, first);
  }

  function ensureDirectAllowed(room, userId) {
    if (room.type !== 'direct') return;
    const other = roomMembers(room.id, false).find((member) => member.id !== userId);
    if (other && blockedBetween(userId, other.id)) throw fail(403, '차단된 친구와는 메시지를 주고받을 수 없습니다.');
  }

  function serializeMessage(row) {
    return { id: row.id, roomId: row.room_id, senderId: row.sender_id, text: row.text, createdAt: row.created_at,
      unreadCount: db.prepare('SELECT COUNT(*) AS count FROM members WHERE room_id = ? AND active = 1 AND user_id <> ? AND read_message_id < ?').get(row.room_id, row.sender_id, row.id).count };
  }

  function serializeRoom(row, userId) {
    const members = roomMembers(row.id, row.type === 'group').map(publicUser);
    const last = db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
    const unread = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE room_id = ? AND id > ? AND sender_id <> ?').get(row.id, row.read_message_id, userId).count;
    const name = row.name || (row.type === 'self' ? '나와의 채팅' : members.filter((user) => user.id !== userId).map((user) => user.name).join(', '));
    return { id: row.id, name, type: row.type, members, lastMessage: last ? { id: last.id, text: last.text, senderId: last.sender_id, createdAt: last.created_at } : null,
      unreadCount: unread, pinned: !!row.pinned, muted: !!row.muted, updatedAt: row.updated_at };
  }

  function getFriend(owner, friend) {
    const row = db.prepare('SELECT u.*, f.alias, f.favorite, f.hidden, f.blocked FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.owner_id = ? AND f.friend_id = ?').get(owner, friend);
    return row && { ...publicUser(row), alias: row.alias, favorite: !!row.favorite, hidden: !!row.hidden, blocked: !!row.blocked };
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    rateLimit(`register:${req.ip}`, 20, 10 * 60 * 1000);
    const handle = stringValue(req.body.handle, '아이디', { min: 3, max: 30 }).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]*$/.test(handle)) throw fail(400, '아이디는 영문, 숫자, 밑줄, 점, 하이픈을 사용해 주세요.');
    const name = stringValue(req.body.name, '이름', { min: 1, max: 30 });
    const password = stringValue(req.body.password, '비밀번호', { min: 8, max: 128, trim: false });
    const status = req.body.status === undefined ? '' : stringValue(req.body.status, '상태 메시지');
    if (db.prepare('SELECT 1 FROM users WHERE handle = ?').get(handle)) throw fail(409, '이미 사용 중인 아이디입니다.');
    const salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${(await deriveKey(password, salt, 64)).toString('hex')}`;
    let id;
    try {
      id = Number(db.prepare('INSERT INTO users (handle, name, status, password_hash, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(handle, name, status, hash, COLORS[Math.floor(Math.random() * COLORS.length)], new Date().toISOString()).lastInsertRowid);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw fail(409, '이미 사용 중인 아이디입니다.');
      throw error;
    }
    res.status(201).json(issueSession(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  }));

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    rateLimit(`login:${req.ip}`, 40, 10 * 60 * 1000);
    const handle = stringValue(req.body.handle, '아이디', { min: 1, max: 30 }).toLowerCase();
    const password = stringValue(req.body.password, '비밀번호', { min: 1, max: 128, trim: false });
    const user = db.prepare('SELECT * FROM users WHERE handle = ?').get(handle);
    const [salt, expected] = (user?.password_hash || '00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
    const actual = await deriveKey(password, salt, 64);
    if (!user || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw fail(401, '아이디 또는 비밀번호를 확인해 주세요.');
    res.json(issueSession(user));
  }));

  app.use('/api', authenticate);
  app.get('/api/me', (req, res) => res.json(publicUser(req.user)));
  app.patch('/api/me', (req, res, next) => {
    try {
      const name = req.body.name === undefined ? req.user.name : stringValue(req.body.name, '이름', { min: 1, max: 30 });
      const status = req.body.status === undefined ? req.user.status : stringValue(req.body.status, '상태 메시지');
      const color = req.body.avatarColor === undefined ? req.user.avatar_color : stringValue(req.body.avatarColor, '프로필 색상', { max: 7 });
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw fail(400, '올바른 프로필 색상이 필요합니다.');
      db.prepare('UPDATE users SET name = ?, status = ?, avatar_color = ? WHERE id = ?').run(name, status, color, req.user.id);
      const affected = db.prepare('SELECT owner_id AS id FROM friends WHERE friend_id = ? UNION SELECT m.user_id AS id FROM members m JOIN members mine ON mine.room_id = m.room_id WHERE mine.user_id = ? AND mine.active = 1 AND m.active = 1').all(req.user.id, req.user.id);
      changed([req.user.id, ...affected.map((row) => row.id)], 'profile');
      res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    for (const socket of io.sockets.sockets.values()) if (socket.data.sessionHash === req.sessionHash) socket.disconnect(true);
    res.json({ ok: true });
  });

  app.get('/api/users', (req, res, next) => {
    try {
      const query = stringValue(req.query.q ?? '', '검색어', { max: 80 });
      const pattern = `%${escapeLike(query)}%`;
      const rows = db.prepare("SELECT * FROM users WHERE id <> ? AND (name LIKE ? ESCAPE '\\' OR handle LIKE ? ESCAPE '\\') ORDER BY name, id LIMIT 30").all(req.user.id, pattern, pattern);
      res.json(rows.map(publicUser));
    } catch (error) { next(error); }
  });
  app.get('/api/friends', (req, res) => {
    const rows = db.prepare('SELECT friend_id FROM friends WHERE owner_id = ? ORDER BY favorite DESC, friend_id').all(req.user.id);
    res.json(rows.map((row) => getFriend(req.user.id, row.friend_id)));
  });
  app.post('/api/friends', (req, res, next) => {
    try {
      const handle = stringValue(req.body.handle, '아이디', { min: 1, max: 30 }).toLowerCase();
      const friend = db.prepare('SELECT * FROM users WHERE handle = ?').get(handle);
      if (!friend) throw fail(404, '해당 아이디의 사용자를 찾을 수 없습니다.');
      if (friend.id === req.user.id) throw fail(400, '자신을 친구로 추가할 수 없습니다.');
      db.prepare('INSERT OR IGNORE INTO friends (owner_id, friend_id) VALUES (?, ?)').run(req.user.id, friend.id);
      changed([req.user.id], 'friends');
      res.status(201).json(getFriend(req.user.id, friend.id));
    } catch (error) { next(error); }
  });
  app.patch('/api/friends/:id', (req, res, next) => {
    try {
      const id = idValue(req.params.id);
      const friend = getFriend(req.user.id, id);
      if (!friend) throw fail(404, '친구를 찾을 수 없습니다.');
      const alias = req.body.alias === undefined ? friend.alias : stringValue(req.body.alias, '친구 이름', { max: 30 });
      const fields = Object.fromEntries(['favorite', 'hidden', 'blocked'].map((key) => [key, req.body[key] === undefined ? Number(friend[key]) : booleanValue(req.body[key], key)]));
      db.prepare('UPDATE friends SET alias = ?, favorite = ?, hidden = ?, blocked = ? WHERE owner_id = ? AND friend_id = ?').run(alias, fields.favorite, fields.hidden, fields.blocked, req.user.id, id);
      changed([req.user.id], 'friends');
      res.json(getFriend(req.user.id, id));
    } catch (error) { next(error); }
  });
  app.delete('/api/friends/:id', (req, res, next) => {
    try {
      const id = idValue(req.params.id);
      db.prepare('DELETE FROM friends WHERE owner_id = ? AND friend_id = ?').run(req.user.id, id);
      changed([req.user.id], 'friends');
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get('/api/rooms', (req, res) => {
    const rows = db.prepare('SELECT r.*, m.read_message_id, m.pinned, m.muted FROM rooms r JOIN members m ON m.room_id = r.id WHERE m.user_id = ? AND m.active = 1 ORDER BY m.pinned DESC, r.updated_at DESC, r.id DESC').all(req.user.id);
    res.json(rows.map((row) => serializeRoom(row, req.user.id)));
  });
  app.post('/api/rooms', (req, res, next) => {
    try {
      if (!Array.isArray(req.body.memberIds) || req.body.memberIds.length > 49) throw fail(400, '대화 상대는 최대 49명까지 선택할 수 있습니다.');
      const members = [...new Set(req.body.memberIds.map(idValue))].filter((id) => id !== req.user.id).sort((a, b) => a - b);
      for (const id of members) if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw fail(404, '선택한 사용자를 찾을 수 없습니다.');
      const type = members.length === 0 ? 'self' : members.length === 1 ? 'direct' : 'group';
      if (type === 'direct' && blockedBetween(req.user.id, members[0])) throw fail(403, '차단된 친구와는 대화할 수 없습니다.');
      const name = req.body.name === undefined ? '' : stringValue(req.body.name, '채팅방 이름', { max: 50 });
      const participants = [...members, req.user.id].sort((a, b) => a - b);
      const key = type === 'group' ? null : `${type}:${participants.join(':')}`;
      const roomId = transaction(db, () => {
        const existing = key && db.prepare('SELECT * FROM rooms WHERE unique_key = ?').get(key);
        const now = new Date().toISOString();
        const id = existing?.id ?? Number(db.prepare('INSERT INTO rooms (type, name, unique_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(type, name, key, now, now).lastInsertRowid);
        for (const user of participants) db.prepare('INSERT INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT(room_id, user_id) DO UPDATE SET active = 1').run(id, user, now);
        return id;
      });
      changed(participants, 'rooms', roomId);
      res.status(201).json(serializeRoom(requireRoom(roomId, req.user.id), req.user.id));
    } catch (error) { next(error); }
  });
  app.patch('/api/rooms/:id', (req, res, next) => {
    try {
      const roomId = idValue(req.params.id);
      const room = requireRoom(roomId, req.user.id);
      const pinned = req.body.pinned === undefined ? room.pinned : booleanValue(req.body.pinned, 'pinned');
      const muted = req.body.muted === undefined ? room.muted : booleanValue(req.body.muted, 'muted');
      const name = req.body.name === undefined ? room.name : stringValue(req.body.name, '채팅방 이름', { max: 50 });
      transaction(db, () => {
        db.prepare('UPDATE members SET pinned = ?, muted = ? WHERE room_id = ? AND user_id = ?').run(pinned, muted, roomId, req.user.id);
        if (req.body.name !== undefined) db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(name, roomId);
      });
      changed(req.body.name !== undefined ? roomMembers(roomId).map((member) => member.id) : [req.user.id], 'rooms', roomId);
      res.json(serializeRoom(requireRoom(roomId, req.user.id), req.user.id));
    } catch (error) { next(error); }
  });
  app.delete('/api/rooms/:id', (req, res, next) => {
    try {
      const roomId = idValue(req.params.id);
      requireRoom(roomId, req.user.id);
      const affected = roomMembers(roomId).map((member) => member.id);
      db.prepare('UPDATE members SET active = 0 WHERE room_id = ? AND user_id = ?').run(roomId, req.user.id);
      changed(affected, 'rooms', roomId);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.get('/api/rooms/:id/messages', (req, res, next) => {
    try {
      const roomId = idValue(req.params.id);
      requireRoom(roomId, req.user.id);
      const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : idValue(req.query.before);
      const query = req.query.q === undefined ? '' : stringValue(req.query.q, '검색어', { max: 80 });
      const rows = db.prepare("SELECT * FROM messages WHERE room_id = ? AND id < ? AND text LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 61").all(roomId, before, `%${escapeLike(query)}%`);
      res.json({ messages: rows.slice(0, 60).reverse().map(serializeMessage), hasMore: rows.length > 60 });
    } catch (error) { next(error); }
  });
  app.post('/api/rooms/:id/messages', (req, res, next) => {
    try {
      const roomId = idValue(req.params.id);
      const room = requireRoom(roomId, req.user.id);
      ensureDirectAllowed(room, req.user.id);
      rateLimit(`messages:${req.user.id}`, 180, 60 * 1000);
      const text = stringValue(req.body.text, '메시지', { min: 1, max: 5000 });
      const clientId = req.body.clientId === undefined ? null : stringValue(req.body.clientId, '메시지 식별자', { min: 1, max: 100 });
      if (clientId) {
        const existing = db.prepare('SELECT * FROM messages WHERE sender_id = ? AND client_id = ?').get(req.user.id, clientId);
        if (existing) {
          if (existing.room_id !== roomId || existing.text !== text) throw fail(409, '이미 사용한 메시지 식별자입니다.');
          return res.json(serializeMessage(existing));
        }
      }
      const id = transaction(db, () => {
        const now = new Date().toISOString();
        const id = Number(db.prepare('INSERT INTO messages (room_id, sender_id, text, created_at, client_id) VALUES (?, ?, ?, ?, ?)').run(roomId, req.user.id, text, now, clientId).lastInsertRowid);
        if (room.type === 'direct') db.prepare('UPDATE members SET active = 1 WHERE room_id = ?').run(roomId);
        db.prepare('UPDATE members SET read_message_id = ? WHERE room_id = ? AND user_id = ?').run(id, roomId, req.user.id);
        db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(now, roomId);
        return id;
      });
      const message = serializeMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
      const users = roomMembers(roomId).map((member) => member.id);
      for (const user of users) io.to(`user:${user}`).emit('message:new', message);
      changed(users, 'messages', roomId);
      res.status(201).json(message);
    } catch (error) { next(error); }
  });
  app.post('/api/rooms/:id/read', (req, res, next) => {
    try {
      const roomId = idValue(req.params.id);
      requireRoom(roomId, req.user.id);
      const last = db.prepare('SELECT MAX(id) AS id FROM messages WHERE room_id = ?').get(roomId).id || 0;
      db.prepare('UPDATE members SET read_message_id = MAX(read_message_id, ?) WHERE room_id = ? AND user_id = ?').run(last, roomId, req.user.id);
      changed(roomMembers(roomId).map((member) => member.id), 'read', roomId);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  io.use((socket, next) => {
    const user = sessionForToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('로그인이 필요합니다.'));
    socket.data.userId = user.id;
    socket.data.sessionHash = user.token_hash;
    next();
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    socket.on('typing', (payload, ack) => {
      try {
        if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?').get(socket.data.sessionHash, Date.now())) throw fail(401, '로그인이 필요합니다.');
        rateLimit(`typing:${socket.data.userId}`, 120, 60 * 1000);
        const roomId = idValue(payload?.roomId);
        const isTyping = !!booleanValue(payload?.isTyping, 'isTyping');
        const room = requireRoom(roomId, socket.data.userId);
        ensureDirectAllowed(room, socket.data.userId);
        for (const member of roomMembers(roomId)) if (member.id !== socket.data.userId) io.to(`user:${member.id}`).emit('typing', { roomId, isTyping, userId: socket.data.userId });
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) { if (typeof ack === 'function') ack({ ok: false, error: error.message }); }
    });
  });

  app.use('/api', (_req, _res, next) => next(fail(404, '요청한 API를 찾을 수 없습니다.')));
  if (staticDir && existsSync(resolve(staticDir, 'index.html'))) {
    app.use(express.static(resolve(staticDir), { index: false }));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('[server]', error);
    res.status(status).json({ error: status >= 500 ? '서버 오류가 발생했습니다.' : error.message });
  });

  async function close() {
    if (closed) return;
    closed = true;
    await new Promise((done) => io.close(done));
    if (httpServer.listening) await new Promise((done) => httpServer.close(done));
    db.close();
  }
  return { app, httpServer, io, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const port = Number(process.env.PORT ?? 4100);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be 0–65535.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('HOST must be a loopback address.');
  const backend = createApp({ dbPath: process.env.DB_PATH || resolve(root, 'data/talk.sqlite'), staticDir: process.env.STATIC_DIR || resolve(root, 'dist'), seed: process.env.SEED_DEMO !== 'false' });
  backend.httpServer.listen(port, host, () => {
    const address = backend.httpServer.address();
    console.log(`KAKAOTALK_SERVER_READY:${JSON.stringify({ port: address.port })}`);
  });
  backend.httpServer.on('error', (error) => { console.error(error); process.exitCode = 1; });
  const shutdown = () => backend.close().then(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
