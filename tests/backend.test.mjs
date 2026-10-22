import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/index.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'katalk-test-'));
  const dbPath = join(directory, 'test.sqlite');
  const app = createApp({ dbPath, seed: false, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  function client(cookie = '') {
    return {
      cookie,
      async request(path, method = 'GET', data) {
        const response = await fetch(origin + path, {
          method,
          headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        const next = response.headers.get('set-cookie');
        if (next) this.cookie = next.split(';')[0];
        return { status: response.status, data: await response.json(), headers: response.headers };
      },
    };
  }
  async function register(handle, name = handle) {
    const instance = client();
    const result = await instance.request('/api/auth/register', 'POST', { handle, name, password: 'password123' });
    assert.equal(result.status, 201);
    instance.user = result.data.user;
    return instance;
  }
  return { app, origin, dbPath, directory, client, register };
}

test('registration, password authentication, session expiry/logout and profile isolation', async t => {
  const f = await fixture(t);
  const guest = f.client();
  assert.deepEqual((await guest.request('/api/me')).data, { user: null });
  assert.equal((await guest.request('/api/bootstrap')).status, 401);
  const alice = await f.register('alice', '앨리스');
  assert.ok(alice.cookie.startsWith('katalk_session='));
  assert.equal((await guest.request('/api/auth/register', 'POST', { handle: 'ALICE', name: '중복', password: 'password123' })).status, 409);
  assert.equal((await guest.request('/api/auth/login', 'POST', { handle: 'alice', password: 'wrong-password' })).status, 401);
  const login = await guest.request('/api/auth/login', 'POST', { handle: 'ALICE', password: 'password123' });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(login.headers.get('set-cookie').includes('SameSite=Lax'));
  assert.equal(login.data.user.password_hash, undefined);
  const updated = await alice.request('/api/me', 'PATCH', { name: '앨리스 김', status: '안녕하세요' });
  assert.equal(updated.data.user.status, '안녕하세요');
  assert.deepEqual(Object.keys(updated.data.user).sort(), ['avatar', 'color', 'handle', 'id', 'name', 'status']);
  assert.equal((await guest.request('/api/me')).data.user.name, '앨리스 김');
  const cookie = guest.cookie;
  assert.equal((await guest.request('/api/auth/logout', 'POST')).status, 200);
  assert.equal((await f.client(cookie).request('/api/bootstrap')).status, 401);
  assert.equal((await alice.request('/api/bootstrap')).status, 200);
  f.app.db.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal((await alice.request('/api/bootstrap')).status, 401);
});

test('friend search, private aliases, favorite/hide/block CRUD and bidirectional blocked DMs', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice', '앨리스');
  const bob = await f.register('bob', '밥');
  const found = await alice.request('/api/users?q=bob');
  assert.deepEqual(found.data.users.map(user => user.id), [bob.user.id]);
  assert.equal((await alice.request('/api/users?q=%25')).data.users.length, 0, 'SQL wildcards are escaped');
  assert.equal((await alice.request('/api/friends', 'POST', { userId: alice.user.id })).status, 400);
  await alice.request('/api/friends', 'POST', { userId: bob.user.id });
  const modified = await alice.request(`/api/friends/${bob.user.id}`, 'PATCH', { favorite: true, state: 'hidden', alias: '내 친구' });
  assert.equal(modified.data.friend.alias, '내 친구');
  assert.equal(modified.data.friend.favorite, true);
  assert.equal(modified.data.friend.state, 'hidden');
  assert.equal((await bob.request('/api/bootstrap')).data.friends.length, 0);
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] })).data.room;
  assert.equal(room.type, 'direct');
  assert.equal((await bob.request('/api/rooms', 'POST', { memberIds: [alice.user.id] })).data.room.id, room.id);
  await alice.request(`/api/friends/${bob.user.id}`, 'PATCH', { state: 'blocked' });
  for (const person of [alice, bob]) {
    assert.equal((await person.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '차단 테스트' })).status, 403);
    assert.equal((await person.request(`/api/rooms/${room.id}/typing`, 'POST', { active: true })).status, 403);
  }
  assert.equal((await bob.request('/api/rooms', 'POST', { memberIds: [alice.user.id] })).status, 403);
  await alice.request(`/api/friends/${bob.user.id}`, 'PATCH', { state: 'normal' });
  assert.equal((await bob.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '다시 안녕' })).status, 201);
  assert.equal((await alice.request(`/api/friends/${bob.user.id}`, 'DELETE')).status, 200);
  assert.equal((await alice.request('/api/bootstrap')).data.friends.length, 0);
});

test('direct/group/self chat, idempotent sends, unread receipts, search and membership authorization', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const carol = await f.register('carol');
  const outsider = await f.register('outsider');
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id, carol.user.id], name: '친구들' })).data.room;
  assert.equal(room.type, 'group');
  assert.equal(room.members.length, 3);
  const first = await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '안녕하세요\n모두 반가워요!', clientId: 'first-message' });
  assert.equal(first.data.message.unread, 2);
  const retry = await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '안녕하세요\n모두 반가워요!', clientId: 'first-message' });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.message.id, first.data.message.id);
  assert.equal((await bob.request('/api/bootstrap')).data.rooms[0].unread, 1);
  await bob.request(`/api/rooms/${room.id}/read`, 'POST');
  assert.equal((await alice.request(`/api/rooms/${room.id}/messages`)).data.messages[0].unread, 1);
  assert.equal((await bob.request('/api/bootstrap')).data.rooms[0].unread, 0);
  await bob.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '두 번째 메시지' });
  const messages = (await carol.request(`/api/rooms/${room.id}/messages`)).data.messages;
  assert.equal(messages.length, 2);
  assert.ok(messages[0].id < messages[1].id);
  assert.equal((await carol.request(`/api/rooms/${room.id}/messages?q=${encodeURIComponent('두 번째')}`)).data.messages.length, 1);
  for (const [route, method, data] of [
    ['', 'PATCH', { name: '침입' }], ['', 'DELETE'], ['/messages', 'GET'], ['/messages', 'POST', { text: '침입' }], ['/read', 'POST'], ['/typing', 'POST', { active: true }],
  ]) assert.equal((await outsider.request(`/api/rooms/${room.id}${route}`, method, data)).status, 404);
  assert.equal((await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: ' '.repeat(5) })).status, 400);
  assert.equal((await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: 'a'.repeat(4001) })).status, 400);
  const changed = await bob.request(`/api/rooms/${room.id}`, 'PATCH', { name: '새 이름', pinned: true, muted: true });
  assert.equal(changed.data.room.pinned, true);
  const othersRoom = (await alice.request('/api/bootstrap')).data.rooms[0];
  assert.equal(othersRoom.name, '새 이름');
  assert.equal(othersRoom.pinned, false);
  await carol.request(`/api/rooms/${room.id}`, 'DELETE');
  assert.equal((await carol.request(`/api/rooms/${room.id}/messages`)).status, 404);
  assert.equal((await alice.request(`/api/rooms/${room.id}/messages`)).data.messages[0].unread, 0);
  const self = (await alice.request('/api/rooms', 'POST', { memberIds: [] })).data.room;
  assert.equal(self.type, 'self');
  assert.equal((await alice.request('/api/rooms', 'POST', { memberIds: [] })).data.room.id, self.id);
  assert.equal((await alice.request(`/api/rooms/${self.id}/messages`, 'POST', { text: '나의 메모' })).data.message.unread, 0);
});

test('SQLite preserves accounts, sessions, friends and messages across application restart', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  await alice.request('/api/friends', 'POST', { userId: bob.user.id });
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] })).data.room;
  await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '재시작 후에도 남는 메시지' });
  await f.app.close();
  const restarted = createApp({ dbPath: f.dbPath, seed: false });
  t.after(() => restarted.close());
  await new Promise(resolve => restarted.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${restarted.server.address().port}`;
  const state = await (await fetch(url + '/api/bootstrap', { headers: { Cookie: alice.cookie } })).json();
  assert.equal(state.user.id, alice.user.id);
  assert.equal(state.friends[0].id, bob.user.id);
  assert.equal(state.rooms[0].lastMessage.text, '재시작 후에도 남는 메시지');
  await restarted.close();
});

test('leaving and reopening direct chats preserves the counterpart and clears only the leaving user history', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] })).data.room;
  await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '나가기 전 메시지' });
  await bob.request(`/api/rooms/${room.id}`, 'DELETE');
  assert.equal((await bob.request('/api/bootstrap')).data.rooms.length, 0);
  assert.equal((await bob.request(`/api/rooms/${room.id}/messages`)).status, 404);
  const remaining = (await alice.request('/api/bootstrap')).data.rooms[0];
  assert.equal(remaining.members.length, 2);
  assert.equal(remaining.name, 'bob');
  assert.equal((await alice.request(`/api/rooms/${room.id}/messages`)).data.messages.length, 1);
  const reopened = (await bob.request('/api/rooms', 'POST', { memberIds: [alice.user.id] })).data.room;
  assert.equal(reopened.id, room.id);
  assert.equal(reopened.lastMessage, null);
  assert.deepEqual((await bob.request(`/api/rooms/${room.id}/messages`)).data.messages, []);
  await bob.request(`/api/rooms/${room.id}`, 'DELETE');
  const delivered = await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '나간 뒤 새 메시지' });
  assert.equal(delivered.data.message.unread, 1);
  const restored = (await bob.request('/api/bootstrap')).data.rooms;
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, room.id);
  assert.equal(restored[0].unread, 1);
  const history = (await bob.request(`/api/rooms/${room.id}/messages`)).data.messages;
  assert.deepEqual(history.map(message => message.text), ['나간 뒤 새 메시지']);
  await bob.request(`/api/rooms/${room.id}/read`, 'POST');
  assert.equal((await alice.request(`/api/rooms/${room.id}/messages`)).data.messages.at(-1).unread, 0);
  await alice.request(`/api/rooms/${room.id}`, 'DELETE');
  await bob.request(`/api/rooms/${room.id}`, 'DELETE');
  const fresh = (await bob.request('/api/rooms', 'POST', { memberIds: [alice.user.id] })).data.room;
  assert.notEqual(fresh.id, room.id);
  assert.equal(fresh.members.length, 2);
  assert.deepEqual((await alice.request(`/api/rooms/${fresh.id}/messages`)).data.messages, []);
});

test('inactive direct memberships enforce authorization, blocking and history cutoffs on searches and retries', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  await alice.request('/api/friends', 'POST', { userId: bob.user.id });
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] })).data.room;
  const old = await bob.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '지워질 대화', clientId: 'before-leave' });
  await bob.request(`/api/rooms/${room.id}`, 'PATCH', { pinned: true });
  await bob.request(`/api/rooms/${room.id}`, 'DELETE');
  for (const [route, method, data] of [
    ['', 'PATCH', { name: '접근 불가' }], ['', 'DELETE'], ['/messages', 'GET'],
    ['/messages', 'POST', { text: '접근 불가' }], ['/read', 'POST'], ['/typing', 'POST', { active: true }],
  ]) assert.equal((await bob.request(`/api/rooms/${room.id}${route}`, method, data)).status, 404);
  const duplicate = await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] });
  assert.equal(duplicate.data.room.id, room.id);
  assert.equal((await bob.request('/api/bootstrap')).data.rooms.length, 0, 'opening a room does not restore the other user');
  await alice.request(`/api/friends/${bob.user.id}`, 'PATCH', { state: 'blocked' });
  assert.equal((await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '차단 중' })).status, 403);
  assert.equal((await bob.request('/api/rooms', 'POST', { memberIds: [alice.user.id] })).status, 403);
  assert.equal((await bob.request('/api/bootstrap')).data.rooms.length, 0);
  await alice.request(`/api/friends/${bob.user.id}`, 'PATCH', { state: 'normal' });
  const reopened = (await bob.request('/api/rooms', 'POST', { memberIds: [alice.user.id] })).data.room;
  assert.equal(reopened.pinned, false);
  assert.equal(reopened.unread, 0);
  assert.deepEqual((await bob.request(`/api/rooms/${room.id}/messages?q=${encodeURIComponent('지워질')}`)).data.messages, []);
  const stale = await bob.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '지워질 대화', clientId: 'before-leave' });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.message, undefined);
  assert.deepEqual((await bob.request(`/api/rooms/${room.id}/messages`)).data.messages, []);
  const fresh = await bob.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '새 대화', clientId: 'after-leave' });
  assert.equal(fresh.status, 201);
  assert.ok(fresh.data.message.id > old.data.message.id);
  assert.deepEqual((await bob.request(`/api/rooms/${room.id}/messages`)).data.messages.map(message => message.text), ['새 대화']);
  assert.deepEqual((await alice.request(`/api/rooms/${room.id}/messages`)).data.messages.map(message => message.text), ['지워질 대화', '새 대화']);
});

test('legacy SQLite membership schema is upgraded without losing existing chats', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] })).data.room;
  await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '업그레이드 전 대화' });
  f.app.db.exec('ALTER TABLE room_members DROP COLUMN active; ALTER TABLE room_members DROP COLUMN visible_after_id;');
  await f.app.close();
  const restarted = createApp({ dbPath: f.dbPath, seed: false });
  t.after(() => restarted.close());
  await new Promise(resolve => restarted.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${restarted.server.address().port}`;
  const response = await fetch(url + `/api/rooms/${room.id}/messages`, { headers: { Cookie: bob.cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages.map(message => message.text), ['업그레이드 전 대화']);
  assert.deepEqual(restarted.db.prepare('SELECT active, visible_after_id FROM room_members').all().map(row => ({ ...row })), [
    { active: 1, visible_after_id: 0 }, { active: 1, visible_after_id: 0 },
  ]);
  await restarted.close();
});

test('in-flight writes recheck blocking, room membership and authentication after reading their body', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  await alice.request('/api/friends', 'POST', { userId: bob.user.id });
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] })).data.room;
  async function delayed(client, route, method, data) {
    const encoded = JSON.stringify(data);
    const observed = new Promise(resolve => f.app.server.once('request', resolve));
    let pending;
    const result = new Promise((resolve, reject) => {
      pending = httpRequest(f.origin + route, { method, headers: { Cookie: client.cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      pending.on('error', reject);
      pending.flushHeaders();
    });
    t.after(() => pending.destroy());
    await observed;
    return { complete: () => { pending.end(encoded); return result; } };
  }
  const pendingSend = await delayed(bob, `/api/rooms/${room.id}/messages`, 'POST', { text: '차단 직전 시작된 전송' });
  await alice.request(`/api/friends/${bob.user.id}`, 'PATCH', { state: 'blocked' });
  assert.equal(await pendingSend.complete(), 403);
  await alice.request(`/api/friends/${bob.user.id}`, 'PATCH', { state: 'normal' });
  const pendingTyping = await delayed(bob, `/api/rooms/${room.id}/typing`, 'POST', { active: true });
  await bob.request(`/api/rooms/${room.id}`, 'DELETE');
  assert.equal(await pendingTyping.complete(), 404);
  const pendingProfile = await delayed(bob, '/api/me', 'PATCH', { name: '로그아웃 뒤 이름 변경' });
  await bob.request('/api/auth/logout', 'POST');
  assert.equal(await pendingProfile.complete(), 401);
  assert.equal((await alice.request('/api/users?q=bob')).data.users[0].name, 'bob');
});

test('realtime events respect active memberships and stop after logout or session expiry', async t => {
  const f = await fixture(t);
  const alice = await f.register('alice');
  const bob = await f.register('bob');
  const outsider = await f.register('outsider');
  const room = (await alice.request('/api/rooms', 'POST', { memberIds: [bob.user.id] })).data.room;
  async function events(client) {
    const controller = new AbortController();
    const response = await fetch(f.origin + '/api/events', { headers: { Cookie: client.cookie }, signal: controller.signal });
    const received = [];
    const reader = response.body.getReader();
    const done = (async () => {
      let buffer = '';
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          buffer += new TextDecoder().decode(next.value);
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame.startsWith('data: ')) received.push(JSON.parse(frame.slice(6)));
          }
        }
      } catch (error) { if (error.name !== 'AbortError') throw error; }
    })();
    t.after(async () => { controller.abort(); await done; });
    return { received, done };
  }
  const bobEvents = await events(bob);
  const outsiderEvents = await events(outsider);
  await alice.request(`/api/rooms/${room.id}/typing`, 'POST', { active: true });
  await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '실시간 메시지' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(bobEvents.received.map(event => event.type), ['typing', 'sync']);
  assert.equal(bobEvents.received[0].roomId, room.id);
  assert.equal(outsiderEvents.received.length, 0);
  await bob.request('/api/auth/logout', 'POST');
  await bobEvents.done;
  await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '로그아웃 후' });
  assert.equal(bobEvents.received.length, 2);
  await bob.request('/api/auth/login', 'POST', { handle: 'bob', password: 'password123' });
  const returningEvents = await events(bob);
  await bob.request(`/api/rooms/${room.id}`, 'DELETE');
  await alice.request(`/api/rooms/${room.id}/typing`, 'POST', { active: true });
  await alice.request(`/api/rooms/${room.id}/messages`, 'POST', { text: '새 메시지로 다시 열린 방' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(returningEvents.received.map(event => event.type), ['sync', 'sync'], 'inactive members get restoration sync but no typing');
  assert.equal((await bob.request('/api/bootstrap')).data.rooms[0].id, room.id);
  f.app.db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(bob.user.id);
  await alice.request(`/api/rooms/${room.id}/typing`, 'POST', { active: true });
  await returningEvents.done;
  assert.equal(returningEvents.received.length, 2, 'expired sessions receive no events even before their next heartbeat');
});

test('demo seed is fictional, useful and idempotent; cross-origin writes are denied', async t => {
  const f = await fixture(t, { seed: true });
  const young = f.client();
  assert.equal((await young.request('/api/auth/login', 'POST', { handle: 'young', password: 'demo1234' })).status, 200);
  const state = (await young.request('/api/bootstrap')).data;
  assert.equal(state.user.name, '김영');
  assert.equal(state.friends.length, 3);
  assert.equal(state.rooms.length, 4);
  assert.equal(state.rooms.filter(room => room.unread > 0).length, 2);
  const denied = await fetch(f.origin + '/api/me', { method: 'PATCH', headers: { Origin: 'https://example.org', Cookie: young.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '원치 않는 변경' }) });
  assert.equal(denied.status, 403);
  assert.equal((await young.request('/api/me')).data.user.name, '김영');
});
