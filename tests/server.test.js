import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { io as connectSocket } from 'socket.io-client';
import { createApp } from '../server/index.js';

async function fixture(t, { seed = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'talk-backend-'));
  const dbPath = join(directory, 'talk.sqlite');
  let backend;
  let base;
  const sockets = [];
  const start = async () => {
    backend = createApp({ dbPath, seed });
    backend.httpServer.listen(0, '127.0.0.1');
    await once(backend.httpServer, 'listening');
    base = `http://127.0.0.1:${backend.httpServer.address().port}`;
  };
  await start();
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await backend.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (path, { method = 'GET', token, body, expected = 200 } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(json)}`);
    return json;
  };
  const register = (handle, name = handle) => request('/api/auth/register', { method: 'POST', body: { handle, name, password: 'test-password' }, expected: 201 });
  const api = (auth, path, options = {}) => request(path, { ...options, token: auth.token });
  const socketFor = async (auth) => {
    const socket = connectSocket(base, { auth: { token: auth.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; }), new Promise((_, reject) => setTimeout(() => reject(new Error('Socket connection timeout')), 4000).unref())]);
    return socket;
  };
  return { request, register, api, socketFor, base: () => base, restart: async () => { for (const socket of sockets) socket.disconnect(); await backend.close(); await start(); } };
}

function eventOnce(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off(name, listener); reject(new Error(`Missing ${name} event`)); }, 4000);
    const listener = (event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      socket.off(name, listener);
      resolve(event);
    };
    socket.on(name, listener);
  });
}

test('authentication validates credentials, keeps secrets private, and revokes logout tokens', async (t) => {
  const f = await fixture(t);
  await f.request('/api/me', { expected: 401 });
  await f.request('/api/auth/register', { method: 'POST', body: { handle: 'bad name', name: 'Bad', password: 'test-password' }, expected: 400 });
  await f.request('/api/auth/register', { method: 'POST', body: { handle: 'short', name: 'Short', password: '123' }, expected: 400 });
  const auth = await f.register('alice', '앨리스');
  assert.equal(auth.token.length, 64);
  assert.deepEqual(Object.keys(auth.user).sort(), ['avatarColor', 'handle', 'id', 'name', 'status']);
  await f.request('/api/auth/register', { method: 'POST', body: { handle: 'ALICE', name: 'Duplicate', password: 'test-password' }, expected: 409 });
  await f.request('/api/auth/login', { method: 'POST', body: { handle: 'alice', password: 'wrong-password' }, expected: 401 });
  const login = await f.request('/api/auth/login', { method: 'POST', body: { handle: 'ALICE', password: 'test-password' } });
  assert.equal(login.user.id, auth.user.id);
  assert.notEqual(login.token, auth.token);
  await f.api(login, '/api/auth/logout', { method: 'POST' });
  await f.api(login, '/api/me', { expected: 401 });
  assert.equal((await f.api(auth, '/api/me')).name, '앨리스');
});

test('friends support aliases, favorites, hidden lists, literal search and directional management', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  await f.api(alice, '/api/friends', { method: 'POST', body: { handle: 'alice' }, expected: 400 });
  const friend = await f.api(alice, '/api/friends', { method: 'POST', body: { handle: 'bob' }, expected: 201 });
  assert.equal(friend.id, bob.user.id);
  const updated = await f.api(alice, `/api/friends/${bob.user.id}`, { method: 'PATCH', body: { alias: '보브', favorite: true, hidden: true } });
  assert.equal(updated.alias, '보브');
  assert.equal(updated.favorite, true);
  assert.equal(updated.hidden, true);
  assert.deepEqual(await f.api(bob, '/api/friends'), []);
  assert.equal((await f.api(alice, '/api/friends')).length, 1);
  assert.deepEqual(await f.api(alice, '/api/users?q=%25'), []);
  assert.equal((await f.api(alice, '/api/users?q=bo'))[0].handle, 'bob');
  await f.api(alice, `/api/friends/${bob.user.id}`, { method: 'PATCH', body: { favorite: 'true' }, expected: 400 });
  await f.api(alice, `/api/friends/${bob.user.id}`, { method: 'DELETE' });
  assert.deepEqual(await f.api(alice, '/api/friends'), []);
});

test('profile updates propagate through friends and room participants without leaking authentication data', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  await f.api(bob, '/api/friends', { method: 'POST', body: { handle: 'alice' }, expected: 201 });
  const socket = await f.socketFor(bob);
  const change = eventOnce(socket, 'data:changed', (event) => event.reason === 'profile');
  const user = await f.api(alice, '/api/me', { method: 'PATCH', body: { name: '새 이름', status: '산책 중', avatarColor: '#ABC123' } });
  await change;
  assert.equal(user.status, '산책 중');
  assert.equal((await f.api(bob, '/api/friends'))[0].name, '새 이름');
  await f.api(alice, '/api/me', { method: 'PATCH', body: { avatarColor: 'red' }, expected: 400 });
});

test('direct and self rooms are reused, memberships are enforced, and personal preferences are private', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const outsider = await f.register('outsider');
  const room = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [bob.user.id, bob.user.id, alice.user.id] }, expected: 201 });
  const duplicate = await f.api(bob, '/api/rooms', { method: 'POST', body: { memberIds: [alice.user.id] }, expected: 201 });
  assert.equal(duplicate.id, room.id);
  assert.equal(room.type, 'direct');
  assert.equal(room.members.length, 2);
  await f.api(outsider, `/api/rooms/${room.id}/messages`, { expected: 404 });
  await f.api(outsider, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: 'injected' }, expected: 404 });
  await f.api(outsider, `/api/rooms/${room.id}/read`, { method: 'POST', body: {}, expected: 404 });
  await f.api(alice, `/api/rooms/${room.id}`, { method: 'PATCH', body: { pinned: true, muted: true } });
  assert.equal((await f.api(alice, '/api/rooms'))[0].pinned, true);
  assert.equal((await f.api(bob, '/api/rooms'))[0].pinned, false);
  const self = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [] }, expected: 201 });
  const again = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [alice.user.id] }, expected: 201 });
  assert.equal(self.type, 'self');
  assert.equal(self.id, again.id);
});

test('actual messages arrive over authenticated sockets, unread counters advance and reads update both clients', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const room = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [bob.user.id] }, expected: 201 });
  const socket = await f.socketFor(bob);
  const received = eventOnce(socket, 'message:new', (event) => event.roomId === room.id);
  const message = await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: '안녕, 진짜 메시지야! 😊', clientId: 'alice-message-1' }, expected: 201 });
  assert.equal((await received).id, message.id);
  assert.equal(message.senderId, alice.user.id);
  assert.equal(message.unreadCount, 1);
  assert.equal((await f.api(bob, '/api/rooms'))[0].unreadCount, 1);
  assert.equal((await f.api(alice, '/api/rooms'))[0].unreadCount, 0);
  const duplicate = await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: message.text, clientId: 'alice-message-1' } });
  assert.equal(duplicate.id, message.id);
  await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: 'different', clientId: 'alice-message-1' }, expected: 409 });
  const changed = eventOnce(socket, 'data:changed', (event) => event.reason === 'read');
  await f.api(bob, `/api/rooms/${room.id}/read`, { method: 'POST' });
  await changed;
  assert.equal((await f.api(bob, '/api/rooms'))[0].unreadCount, 0);
  assert.equal((await f.api(alice, `/api/rooms/${room.id}/messages`)).messages[0].unreadCount, 0);
  assert.equal((await f.api(bob, `/api/rooms/${room.id}/messages`)).messages.length, 1);
});

test('blocking prevents direct messages and typing in both directions, and unblocking restores them', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const room = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [bob.user.id] }, expected: 201 });
  await f.api(alice, '/api/friends', { method: 'POST', body: { handle: 'bob' }, expected: 201 });
  await f.api(alice, `/api/friends/${bob.user.id}`, { method: 'PATCH', body: { blocked: true } });
  await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: 'blocked' }, expected: 403 });
  await f.api(bob, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: 'also blocked' }, expected: 403 });
  await f.api(bob, '/api/rooms', { method: 'POST', body: { memberIds: [alice.user.id] }, expected: 403 });
  const socket = await f.socketFor(bob);
  const rejected = await socket.timeout(4000).emitWithAck('typing', { roomId: room.id, isTyping: true });
  assert.equal(rejected.ok, false);
  await f.api(alice, `/api/friends/${bob.user.id}`, { method: 'PATCH', body: { blocked: false } });
  await f.api(bob, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: 'works now' }, expected: 201 });
});

test('groups count readers, broadcast validated typing, share names and keep departed members out', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const cara = await f.register('cara');
  const outsider = await f.register('outsider');
  const room = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [bob.user.id, cara.user.id], name: '우리 셋' }, expected: 201 });
  assert.equal(room.type, 'group');
  const aliceSocket = await f.socketFor(alice);
  const bobSocket = await f.socketFor(bob);
  const outsideSocket = await f.socketFor(outsider);
  const typing = eventOnce(bobSocket, 'typing');
  assert.equal((await aliceSocket.timeout(4000).emitWithAck('typing', { roomId: room.id, isTyping: true })).ok, true);
  assert.equal((await typing).userId, alice.user.id);
  assert.equal((await outsideSocket.timeout(4000).emitWithAck('typing', { roomId: room.id, isTyping: true })).ok, false);
  const message = await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: '그룹 메시지' }, expected: 201 });
  assert.equal(message.unreadCount, 2);
  await f.api(bob, `/api/rooms/${room.id}/read`, { method: 'POST', body: {} });
  assert.equal((await f.api(alice, `/api/rooms/${room.id}/messages`)).messages[0].unreadCount, 1);
  await f.api(cara, `/api/rooms/${room.id}`, { method: 'PATCH', body: { name: '새 채팅방 이름' } });
  assert.equal((await f.api(alice, '/api/rooms'))[0].name, '새 채팅방 이름');
  await f.api(cara, `/api/rooms/${room.id}`, { method: 'DELETE' });
  await f.api(cara, `/api/rooms/${room.id}/messages`, { expected: 404 });
  await f.api(cara, `/api/rooms/${room.id}`, { method: 'PATCH', body: { name: 'hijack' }, expected: 404 });
  assert.deepEqual(await f.api(cara, '/api/rooms'), []);
  assert.equal((await f.api(alice, '/api/rooms'))[0].members.length, 2);
});

test('history pagination has no overlap, escapes searches, and rejects malformed messages', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const room = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [] }, expected: 201 });
  for (let i = 0; i < 65; i += 1) await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: i === 1 ? 'literal 100%_done' : `메시지 ${i}` }, expected: 201 });
  const page = await f.api(alice, `/api/rooms/${room.id}/messages`);
  assert.equal(page.messages.length, 60);
  assert.equal(page.hasMore, true);
  const older = await f.api(alice, `/api/rooms/${room.id}/messages?before=${page.messages[0].id}`);
  assert.equal(older.messages.length, 5);
  assert.equal(older.hasMore, false);
  assert.ok(older.messages.at(-1).id < page.messages[0].id);
  assert.equal((await f.api(alice, `/api/rooms/${room.id}/messages?q=${encodeURIComponent('%_')}`)).messages.length, 1);
  await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: '  ' }, expected: 400 });
  await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: 'x'.repeat(5001) }, expected: 400 });
  await f.api(alice, `/api/rooms/${room.id}/messages?before=-1`, { expected: 400 });
});

test('persistent accounts, sessions, friendships, message history and cursors survive a restart', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  await f.api(alice, '/api/friends', { method: 'POST', body: { handle: 'bob' }, expected: 201 });
  const room = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [bob.user.id] }, expected: 201 });
  await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: '재시작해도 남는 대화' }, expected: 201 });
  await f.api(bob, `/api/rooms/${room.id}/read`, { method: 'POST', body: {} });
  await f.restart();
  assert.equal((await f.api(alice, '/api/me')).handle, 'alice');
  assert.equal((await f.api(alice, '/api/friends'))[0].id, bob.user.id);
  assert.equal((await f.api(bob, '/api/rooms'))[0].unreadCount, 0);
  assert.equal((await f.api(bob, `/api/rooms/${room.id}/messages`)).messages[0].text, '재시작해도 남는 대화');
});

test('leaving a direct room removes access until a new peer message restores the room and history', async (t) => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const room = await f.api(alice, '/api/rooms', { method: 'POST', body: { memberIds: [bob.user.id] }, expected: 201 });
  await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: '첫 대화' }, expected: 201 });
  await f.api(bob, `/api/rooms/${room.id}`, { method: 'DELETE' });
  assert.deepEqual(await f.api(bob, '/api/rooms'), []);
  await f.api(bob, `/api/rooms/${room.id}/messages`, { expected: 404 });
  await f.api(alice, `/api/rooms/${room.id}/messages`, { method: 'POST', body: { text: '새 메시지' }, expected: 201 });
  assert.equal((await f.api(bob, '/api/rooms'))[0].id, room.id);
  assert.equal((await f.api(bob, `/api/rooms/${room.id}/messages`)).messages.length, 2);
});

test('seeded demo accounts can log in and seeded rooms remain stable after restart', async (t) => {
  const f = await fixture(t, { seed: true });
  const demo = await f.request('/api/auth/login', { method: 'POST', body: { handle: 'young', password: '12345678' } });
  const rooms = await f.api(demo, '/api/rooms');
  assert.equal(rooms.length, 4);
  assert.equal((await f.api(demo, '/api/friends')).length, 2);
  await f.restart();
  assert.equal((await f.api(demo, '/api/rooms')).length, 4);
});

test('socket authentication rejects unknown tokens and logout closes that authenticated socket', async (t) => {
  const f = await fixture(t);
  const rejected = connectSocket(f.base(), { auth: { token: '0'.repeat(64) }, transports: ['websocket'], reconnection: false });
  await once(rejected, 'connect_error');
  rejected.disconnect();
  const alice = await f.register('alice');
  const socket = await f.socketFor(alice);
  const disconnected = once(socket, 'disconnect');
  await f.api(alice, '/api/auth/logout', { method: 'POST', body: {} });
  await disconnected;
  assert.equal(socket.connected, false);
});

test('concurrent duplicate registrations, direct room creation and client message retries stay unique', async (t) => {
  const f = await fixture(t);
  const rawPost = async (path, body, token) => {
    const response = await fetch(f.base() + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const registration = { handle: 'alice', name: 'Alice', password: 'test-password' };
  const attempts = await Promise.all([rawPost('/api/auth/register', registration), rawPost('/api/auth/register', registration)]);
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409]);
  const alice = attempts.find((result) => result.status === 201).body;
  const bob = await f.register('bob');
  const rooms = await Promise.all([
    rawPost('/api/rooms', { memberIds: [bob.user.id] }, alice.token),
    rawPost('/api/rooms', { memberIds: [alice.user.id] }, bob.token),
  ]);
  assert.ok(rooms.every((result) => result.status === 201));
  assert.equal(rooms[0].body.id, rooms[1].body.id);
  const path = `/api/rooms/${rooms[0].body.id}/messages`;
  const payload = { text: '한 번만 전송', clientId: 'concurrent-retry-1' };
  const messages = await Promise.all([rawPost(path, payload, alice.token), rawPost(path, payload, alice.token)]);
  assert.deepEqual(messages.map((result) => result.status).sort(), [200, 201]);
  assert.equal(messages[0].body.id, messages[1].body.id);
  assert.equal((await f.api(bob, path)).messages.length, 1);
});
