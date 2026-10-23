import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { startServer } from '../server/index.mjs';
import { MessengerStore } from '../server/store.mjs';

const testRoot = fileURLToPath(new URL('../test-results/', import.meta.url));

async function temporaryDirectory(prefix) {
  await mkdir(testRoot, { recursive: true });
  return mkdtemp(join(testRoot, prefix));
}

async function fixture(t) {
  const directory = await temporaryDirectory('katok-test-');
  const dataFile = join(directory, 'state.json');
  const app = await startServer({ port: 0, dataFile });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, path, input, user = 'me', options = {}) => {
    const response = await fetch(`${app.url}${path}?user=${encodeURIComponent(user)}`, {
      method,
      headers: input === undefined ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
      body: input === undefined ? undefined : JSON.stringify(input),
      ...options,
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...app, directory, dataFile, request };
}

test('friend edges are directional; hide/restore preserves room and message access', async t => {
  const { request } = await fixture(t);
  const initial = await request('GET', '/api/bootstrap');
  assert.equal(initial.body.currentUser.id, 'me');
  assert.equal(initial.body.users.length, 4);
  assert.deepEqual(initial.body.friends.map(friend => friend.id), ['hana', 'jun']);
  assert.equal((await request('POST', '/api/friends', { userId: 'sora' })).status, 201);
  assert.equal((await request('POST', '/api/friends', { userId: 'sora' })).status, 409);
  assert.equal((await request('POST', '/api/friends', { userId: 'me' })).status, 400);
  assert.equal((await request('POST', '/api/friends', { userId: 'missing' })).status, 404);
  assert.equal((await request('GET', '/api/bootstrap', undefined, 'sora')).body.friends.length, 0);

  const hidden = await request('PATCH', '/api/friends/hana', { hidden: true });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.hidden, true);
  assert.equal((await request('POST', '/api/friends', { userId: 'hana' })).status, 409);
  const bootstrap = (await request('GET', '/api/bootstrap')).body;
  assert.equal(bootstrap.friends.find(friend => friend.id === 'hana').hidden, true);
  assert.equal(bootstrap.rooms[0].id, 'demo-direct');
  assert.equal((await request('GET', '/api/rooms/demo-direct/messages')).status, 200);
  assert.equal((await request('PATCH', '/api/friends/hana', { hidden: false })).body.hidden, false);
});

test('direct rooms reuse the participant pair; groups keep separate identity', async t => {
  const { request } = await fixture(t);
  const direct = await request('POST', '/api/rooms', { memberIds: ['hana', 'me', 'hana'] });
  assert.equal(direct.body.id, 'demo-direct');
  assert.equal((await request('POST', '/api/rooms', { memberIds: ['me'] }, 'hana')).body.id, direct.body.id);
  const group = await request('POST', '/api/rooms', { memberIds: ['hana', 'jun'], title: '작업방' });
  assert.equal(group.status, 201);
  assert.equal(group.body.type, 'group');
  assert.equal(group.body.title, '작업방');
  assert.deepEqual(group.body.memberIds, ['me', 'hana', 'jun']);
  const another = await request('POST', '/api/rooms', { memberIds: ['hana', 'jun'], title: '다른 방' });
  assert.notEqual(another.body.id, group.body.id);
  assert.equal((await request('POST', '/api/rooms', { memberIds: ['me'] })).status, 400);
  assert.equal((await request('POST', '/api/rooms', { memberIds: [] })).status, 400);
  assert.equal((await request('POST', '/api/rooms', { memberIds: ['unknown'] })).status, 404);
  assert.equal((await request('POST', '/api/rooms', { memberIds: ['hana'], title: 1 })).status, 400);
});

test('message retries are idempotent; concurrent sends receive unique ordered sequences', async t => {
  const { request } = await fixture(t);
  const attempts = await Promise.all(Array.from({ length: 5 }, () => request('POST', '/api/rooms/demo-direct/messages', { text: '한 번만 전송', clientId: 'retry-1' })));
  assert.ok(attempts.every(attempt => attempt.status === 201));
  assert.equal(new Set(attempts.map(attempt => attempt.body.id)).size, 1);
  assert.equal((await request('POST', '/api/rooms/demo-direct/messages', { text: '다른 내용', clientId: 'retry-1' })).status, 409);
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => request('POST', '/api/rooms/demo-direct/messages', { text: `동시 전송 ${index}`, clientId: `parallel-${index}` })));
  assert.equal(new Set(concurrent.map(item => item.body.sequence)).size, 8);
  const messages = (await request('GET', '/api/rooms/demo-direct/messages')).body.messages;
  assert.equal(messages.length, 10);
  assert.deepEqual(messages.map(message => message.sequence), Array.from({ length: 10 }, (_, index) => index + 1));
  // A client identifier is scoped by sender as well as by room.
  assert.equal((await request('POST', '/api/rooms/demo-direct/messages', { text: '하나의 메시지', clientId: 'retry-1' }, 'hana')).body.sequence, 11);
});

test('GET never marks read; room unread and per-message unread follow monotonic recipient cursors', async t => {
  const { request } = await fixture(t);
  await request('GET', '/api/rooms/demo-direct/messages');
  assert.equal((await request('GET', '/api/bootstrap')).body.rooms[0].unreadCount, 1);
  const group = (await request('POST', '/api/rooms', { memberIds: ['hana', 'jun'] })).body;
  const path = `/api/rooms/${group.id}`;
  const first = (await request('POST', `${path}/messages`, { text: '첫 메시지', clientId: 'first' })).body;
  const second = (await request('POST', `${path}/messages`, { text: '둘째 메시지', clientId: 'second' })).body;
  assert.equal(first.unreadCount, 2);
  assert.equal(second.unreadCount, 2);
  assert.equal((await request('GET', '/api/bootstrap', undefined, 'me')).body.rooms.find(room => room.id === group.id).unreadCount, 0);
  assert.equal((await request('GET', '/api/bootstrap', undefined, 'hana')).body.rooms.find(room => room.id === group.id).unreadCount, 2);
  assert.equal((await request('POST', `${path}/read`, { sequence: 1 }, 'hana')).body.sequence, 1);
  let messages = (await request('GET', `${path}/messages`)).body.messages;
  assert.deepEqual(messages.map(message => message.unreadCount), [1, 2]);
  assert.equal((await request('POST', `${path}/read`, { sequence: 2 }, 'jun')).body.sequence, 2);
  assert.equal((await request('POST', `${path}/read`, { sequence: 0 }, 'jun')).body.sequence, 2);
  messages = (await request('GET', `${path}/messages`)).body.messages;
  assert.deepEqual(messages.map(message => message.unreadCount), [0, 1]);
  assert.equal((await request('POST', `${path}/read`, { sequence: 99 }, 'hana')).status, 400);
  assert.equal((await request('POST', `${path}/read`, { sequence: 1.5 }, 'hana')).status, 400);
});

test('sending after an unseen incoming message never advances the direct-room read cursor', async t => {
  const { request } = await fixture(t);
  const path = '/api/rooms/demo-direct';
  await request('POST', `${path}/read`, { sequence: 1 });
  const incoming = (await request('POST', `${path}/messages`, { text: '아직 화면에 도착하지 않은 메시지', clientId: 'unseen' }, 'hana')).body;
  assert.equal(incoming.sequence, 2);
  const outgoing = (await request('POST', `${path}/messages`, { text: '이전 대화에 대한 답장', clientId: 'reply' })).body;
  assert.equal(outgoing.sequence, 3);
  const state = (await request('GET', `${path}/messages`)).body;
  assert.equal(state.readSequence, 1);
  assert.equal(state.messages.find(message => message.id === incoming.id).unreadCount, 1);
  assert.equal(state.messages.find(message => message.id === outgoing.id).unreadCount, 1);
  assert.equal((await request('GET', '/api/bootstrap')).body.rooms[0].unreadCount, 1);
  // Reading only the incoming message clears my badge; my own later message is excluded.
  await request('POST', `${path}/read`, { sequence: 2 });
  const explicitlyRead = (await request('GET', `${path}/messages`)).body;
  assert.equal(explicitlyRead.readSequence, 2);
  assert.equal(explicitlyRead.messages.find(message => message.id === incoming.id).unreadCount, 0);
  assert.equal((await request('GET', '/api/bootstrap')).body.rooms[0].unreadCount, 0);
});

test('group sends preserve unread recipients until each recipient explicitly reads', async t => {
  const { request } = await fixture(t);
  const group = (await request('POST', '/api/rooms', { memberIds: ['hana', 'jun'] })).body;
  const path = `/api/rooms/${group.id}`;
  await request('POST', `${path}/messages`, { text: '읽은 메시지', clientId: 'read-first' }, 'hana');
  await request('POST', `${path}/read`, { sequence: 1 });
  await request('POST', `${path}/messages`, { text: '미확인 메시지', clientId: 'unseen-group' }, 'hana');
  await request('POST', `${path}/messages`, { text: '아직 수신 확인 없이 보낸 답장', clientId: 'reply-group' });
  const current = (await request('GET', `${path}/messages`)).body;
  assert.equal(current.readSequence, 1);
  assert.deepEqual(current.messages.map(message => message.unreadCount), [1, 2, 2]);
  assert.equal((await request('GET', '/api/bootstrap')).body.rooms.find(room => room.id === group.id).unreadCount, 1);
  await request('POST', `${path}/read`, { sequence: 2 }, 'jun');
  assert.deepEqual((await request('GET', `${path}/messages`)).body.messages.map(message => message.unreadCount), [0, 1, 2]);
  await request('POST', `${path}/read`, { sequence: 2 });
  assert.deepEqual((await request('GET', `${path}/messages`)).body.messages.map(message => message.unreadCount), [0, 0, 2]);
  assert.equal((await request('GET', '/api/bootstrap')).body.rooms.find(room => room.id === group.id).unreadCount, 0);
  await request('POST', `${path}/read`, { sequence: 3 }, 'hana');
  assert.deepEqual((await request('GET', `${path}/messages`)).body.messages.map(message => message.unreadCount), [0, 0, 1]);
  await request('POST', `${path}/read`, { sequence: 3 }, 'jun');
  assert.deepEqual((await request('GET', `${path}/messages`)).body.messages.map(message => message.unreadCount), [0, 0, 0]);
});

test('nonmembers cannot see or mutate rooms and malformed inputs fail without mutation', async t => {
  const { request, url } = await fixture(t);
  assert.equal((await request('GET', '/api/rooms/demo-direct/messages', undefined, 'sora')).status, 403);
  assert.equal((await request('POST', '/api/rooms/demo-direct/messages', { text: '침입', clientId: 'intrusion' }, 'sora')).status, 403);
  assert.equal((await request('POST', '/api/rooms/demo-direct/read', { sequence: 1 }, 'sora')).status, 403);
  assert.equal((await request('GET', '/api/bootstrap', undefined, 'sora')).body.rooms.length, 0);
  for (const input of [{ text: '' }, { text: '   ' }, { text: 'x'.repeat(4001) }, { text: 12 }, { text: 'hello', clientId: '' }]) {
    assert.equal((await request('POST', '/api/rooms/demo-direct/messages', input)).status, 400);
  }
  assert.equal((await request('PATCH', '/api/friends/hana', { hidden: 'true' })).status, 400);
  assert.equal((await request('GET', '/api/bootstrap', undefined, 'missing')).status, 404);
  const malformed = await fetch(`${url}/api/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const array = await fetch(`${url}/api/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' });
  assert.equal(array.status, 400);
  const oversized = await fetch(`${url}/api/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(33_000) }) });
  assert.equal(oversized.status, 413);
  assert.equal((await request('GET', '/api/rooms/demo-direct/messages')).body.messages.length, 1);
});

test('localhost Host and same-origin boundaries reject browser cross-site writes and private files', async t => {
  const { request, url } = await fixture(t);
  assert.equal((await request('POST', '/api/friends', { userId: 'sora' }, 'me', { headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' } })).status, 403);
  // fetch normalizes Host; use the HTTP client to exercise DNS-rebinding defense.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const outgoing = httpRequest(`${url}/api/bootstrap`, { headers: { Host: 'evil.example' } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await request('GET', '/api/bootstrap', undefined, 'me', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(`${url}/api/friends`, { method: 'POST', body: 'userId=sora' })).status, 415);
  assert.equal((await fetch(`${url}/package.json`)).status, 404);
  assert.equal((await fetch(`${url}/data/messenger.json`)).status, 404);
  assert.equal((await fetch(`${url}/../server/store.mjs`)).status, 404);
});

test('SSE publishes committed changes and durable state survives reopening', async t => {
  const { request, url, close, dataFile } = await fixture(t);
  const controller = new AbortController();
  const response = await fetch(`${url}/api/events?user=me`, { signal: controller.signal });
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  await request('POST', '/api/friends', { userId: 'sora' });
  const next = await reader.read();
  assert.match(new TextDecoder().decode(next.value), /event: change/);
  controller.abort();
  await reader.cancel().catch(() => {});
  await request('PATCH', '/api/friends/hana', { hidden: true });
  await request('POST', '/api/rooms/demo-direct/messages', { text: '다시 켜도 남는 메시지', clientId: 'durable' });
  await request('POST', '/api/rooms/demo-direct/read', { sequence: 2 }, 'hana');
  await close();
  const reopened = await MessengerStore.open(dataFile);
  assert.ok(reopened.bootstrap('me').friends.some(friend => friend.id === 'sora'));
  assert.equal(reopened.bootstrap('me').friends.find(friend => friend.id === 'hana').hidden, true);
  assert.equal(reopened.messages('demo-direct', 'me').messages.at(-1).text, '다시 켜도 남는 메시지');
  assert.equal(reopened.messages('demo-direct', 'me').messages.at(-1).unreadCount, 0);
});

test('failed persistence leaves memory unchanged and the transaction queue recovers', async t => {
  const { store, dataFile, directory } = await fixture(t);
  const original = await readFile(dataFile, 'utf8');
  const backup = `${dataFile}.backup`;
  await rename(dataFile, backup);
  await mkdir(dataFile);
  await assert.rejects(store.addFriend('me', 'sora'));
  assert.equal(store.bootstrap('me').friends.some(friend => friend.id === 'sora'), false);
  assert.equal(await readFile(backup, 'utf8'), original);
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), []);
  await rm(dataFile, { recursive: true });
  await rename(backup, dataFile);
  assert.equal((await store.addFriend('me', 'sora')).id, 'sora');
});

test('corrupt and incompatible persisted data are preserved and prevent startup', async t => {
  const directory = await temporaryDirectory('katok-corrupt-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  for (const content of ['{broken', JSON.stringify({ version: 2, users: [], rooms: [], friendships: [], messages: [] })]) {
    await writeFile(file, content);
    await assert.rejects(MessengerStore.open(file), /보존/);
    assert.equal(await readFile(file, 'utf8'), content);
  }
});
