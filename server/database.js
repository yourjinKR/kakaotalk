import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

export function openDatabase(path, { seed = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      avatar_color TEXT NOT NULL DEFAULT '#7D8DF6',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friends (
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      alias TEXT NOT NULL DEFAULT '',
      favorite INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_id, friend_id),
      CHECK (owner_id <> friend_id)
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('direct', 'group', 'self')),
      name TEXT NOT NULL DEFAULT '',
      unique_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_message_id INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      client_id TEXT,
      UNIQUE (sender_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS messages_room_id ON messages(room_id, id DESC);
    CREATE INDEX IF NOT EXISTS members_user_id ON members(user_id, active, room_id);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
    PRAGMA user_version = 1;
  `);
  if (seed && db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) seedDatabase(db);
  return db;
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedDatabase(db) {
  transaction(db, () => {
    const salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${scryptSync('12345678', salt, 64).toString('hex')}`;
    const base = Date.now();
    const now = new Date(base).toISOString();
    const insertUser = db.prepare('INSERT INTO users (handle, name, status, avatar_color, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const young = Number(insertUser.run('young', '영', '작은 순간들을 소중하게', '#7589DE', hash, now).lastInsertRowid);
    const seoyeon = Number(insertUser.run('seoyeon', '서연', '오늘도 좋은 하루 ☀️', '#ECAD95', hash, now).lastInsertRowid);
    const minjun = Number(insertUser.run('minjun', '민준', '커피 한 잔의 여유 ☕', '#85B8A8', hash, now).lastInsertRowid);
    const insertFriend = db.prepare('INSERT INTO friends (owner_id, friend_id, favorite) VALUES (?, ?, ?)');
    for (const [owner, friend, favorite] of [[young, seoyeon, 1], [young, minjun, 0], [seoyeon, young, 1], [minjun, young, 0]]) insertFriend.run(owner, friend, favorite);
    const insertRoom = db.prepare('INSERT INTO rooms (type, name, unique_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insertMember = db.prepare('INSERT INTO members (room_id, user_id, joined_at) VALUES (?, ?, ?)');
    const insertMessage = db.prepare('INSERT INTO messages (room_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)');
    const addRoom = (type, name, key, people, rows) => {
      const room = Number(insertRoom.run(type, name, key, now, now).lastInsertRowid);
      for (const user of people) insertMember.run(room, user, now);
      let lastId = 0;
      rows.forEach(([sender, text], index) => {
        const at = new Date(base - (rows.length - index) * 180000).toISOString();
        lastId = Number(insertMessage.run(room, sender, text, at).lastInsertRowid);
        db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(at, room);
      });
      db.prepare('UPDATE members SET read_message_id = ? WHERE room_id = ? AND user_id <> ?').run(lastId, room, young);
      return room;
    };
    addRoom('direct', '', `direct:${young}:${seoyeon}`, [young, seoyeon], [[seoyeon, '이번 주말에 시간 괜찮아?'], [young, '응! 토요일 오후는 어때?'], [seoyeon, '좋아 😊 지난번에 말한 카페에서 만나자!']]);
    addRoom('direct', '', `direct:${young}:${minjun}`, [young, minjun], [[minjun, '새로 만든 채팅 앱 어때?'], [young, '친구랑 이야기할 수 있으니 좋네!']]);
    const group = addRoom('group', '우리들의 이야기', null, [young, seoyeon, minjun], [[young, '여기서 우리 이야기 나눠요 ✨'], [minjun, '좋다! 반가워요 👋'], [seoyeon, '다들 좋은 하루 보내!']]);
    db.prepare('UPDATE members SET pinned = 1 WHERE room_id = ? AND user_id = ?').run(group, young);
    const self = addRoom('self', '', `self:${young}`, [young], [[young, '나에게 보내는 메모 📝\n잊지 말고 오늘의 아이디어를 기록하기.']]);
    db.prepare('UPDATE members SET read_message_id = (SELECT MAX(id) FROM messages WHERE room_id = ?) WHERE room_id = ?').run(self, self);
  });
}
