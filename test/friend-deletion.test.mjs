import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessengerStore } from '../server/store.mjs';
import { startServer } from '../server/index.mjs';

const testRoot = fileURLToPath(new URL('../test-results/', import.meta.url));

async function temporaryState(t) {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'katok-delete-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, dataFile: join(directory, 'state.json') };
}

async function serverFixture(t) {
  const { directory, dataFile } = await temporaryState(t);
  const app = await startServer({ port: 0, dataFile });
  t.after(() => app.close());
  const request = async (method, path, input, user = 'me') => {
    const response = await fetch(`${app.url}${path}?user=${encodeURIComponent(user)}`, {
      method,
      headers: input === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...app, directory, dataFile, request };
}

test('deleting a hidden friend removes only my edge and durably preserves every conversation and read cursor', async t => {
  const { dataFile } = await temporaryState(t);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  const group = await store.createRoom('me', ['hana', 'jun'], '삭제 후에도 남는 방');
  await store.sendMessage('hana', group.id, '함께 읽는 메시지', 'before-delete');
  await store.markRead('me', group.id, 1);
  await store.markRead('me', 'demo-direct', 1);
  await store.setFriendHidden('me', 'hana', true);
  const before = JSON.parse(await readFile(dataFile, 'utf8'));
  notifications.length = 0;

  assert.deepEqual(await store.deleteFriend('me', 'hana'), { userId: 'hana', deleted: true });
  assert.deepEqual(notifications, [['me']]);
  const after = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.deepEqual(after.friendships, before.friendships.filter(edge => !(edge.ownerId === 'me' && edge.userId === 'hana')));
  assert.deepEqual(after.users, before.users);
  assert.deepEqual(after.rooms, before.rooms);
  assert.deepEqual(after.messages, before.messages);

  const reopened = await MessengerStore.open(dataFile);
  assert.equal(reopened.bootstrap('me').friends.some(friend => friend.id === 'hana'), false);
  assert.equal(reopened.bootstrap('hana').friends.some(friend => friend.id === 'me'), true);
  assert.deepEqual(reopened.bootstrap('me').rooms, store.bootstrap('me').rooms);
  assert.deepEqual(reopened.messages(group.id, 'me'), store.messages(group.id, 'me'));
  assert.equal((await reopened.addFriend('me', 'hana')).hidden, false);
  assert.equal((await reopened.createRoom('me', ['hana'])).id, 'demo-direct');
});

test('friend deletion validates targets and repeated concurrent requests are idempotent', async t => {
  const { dataFile } = await temporaryState(t);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  const original = await readFile(dataFile, 'utf8');
  for (const target of [undefined, null, '', '  ', 7, {}, [], 'me']) {
    await assert.rejects(store.deleteFriend('me', target), error => error.status === 400);
  }
  await assert.rejects(store.deleteFriend('me', 'missing'), error => error.status === 404);
  await assert.rejects(store.deleteFriend('missing', 'hana'), error => error.status === 404);
  assert.equal(await readFile(dataFile, 'utf8'), original);
  assert.deepEqual(await store.deleteFriend('me', 'sora'), { userId: 'sora', deleted: false });
  assert.deepEqual(notifications, []);

  const results = await Promise.all(Array.from({ length: 3 }, () => store.deleteFriend('me', 'hana')));
  assert.equal(results.filter(result => result.deleted).length, 1);
  assert.ok(results.every(result => result.userId === 'hana'));
  assert.deepEqual(notifications, [['me']]);
  const committed = await readFile(dataFile, 'utf8');
  assert.deepEqual(await store.deleteFriend('me', 'hana'), { userId: 'hana', deleted: false });
  assert.equal(await readFile(dataFile, 'utf8'), committed);
  assert.deepEqual(notifications, [['me']]);
});

test('DELETE accepts no body, leaves incoming and outgoing chat usable, and re-adding reuses the direct room', async t => {
  const { request } = await serverFixture(t);
  const before = (await request('GET', '/api/rooms/demo-direct/messages')).body;
  const removed = await request('DELETE', '/api/friends/hana');
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { userId: 'hana', deleted: true });
  assert.deepEqual((await request('GET', '/api/rooms/demo-direct/messages')).body, before);
  assert.equal((await request('GET', '/api/bootstrap')).body.friends.some(friend => friend.id === 'hana'), false);
  assert.equal((await request('GET', '/api/bootstrap', undefined, 'hana')).body.friends.some(friend => friend.id === 'me'), true);
  assert.deepEqual((await request('DELETE', '/api/friends/hana')).body, { userId: 'hana', deleted: false });
  assert.equal((await request('DELETE', '/api/friends/me')).status, 400);
  assert.equal((await request('DELETE', '/api/friends/%20%20')).status, 400);
  assert.equal((await request('DELETE', '/api/friends/%ZZ')).status, 400);
  assert.equal((await request('DELETE', '/api/friends/missing')).status, 404);
  assert.equal((await request('DELETE', '/api/friends/jun', undefined, 'missing')).status, 404);

  const path = '/api/rooms/demo-direct';
  const incoming = await request('POST', `${path}/messages`, { text: '삭제 후 수신', clientId: 'after-delete-incoming' }, 'hana');
  const outgoing = await request('POST', `${path}/messages`, { text: '삭제 후 답장', clientId: 'after-delete-outgoing' });
  assert.equal(incoming.status, 201);
  assert.equal(outgoing.status, 201);
  assert.equal(outgoing.body.sequence, incoming.body.sequence + 1);
  assert.equal((await request('GET', '/api/bootstrap')).body.rooms[0].unreadCount, 2);
  assert.equal((await request('GET', `${path}/messages`)).body.readSequence, before.readSequence);
  assert.equal((await request('POST', `${path}/read`, { sequence: incoming.body.sequence })).status, 200);
  assert.equal((await request('GET', '/api/bootstrap')).body.rooms[0].unreadCount, 0);
  assert.equal((await request('GET', `${path}/messages`, undefined, 'hana')).body.messages.at(-1).text, '삭제 후 답장');

  const added = await request('POST', '/api/friends', { userId: 'hana' });
  assert.equal(added.status, 201);
  assert.equal(added.body.hidden, false);
  assert.equal((await request('POST', '/api/rooms', { memberIds: ['hana'] })).body.id, 'demo-direct');
});

test('DELETE sends an owner SSE change only after the friendship deletion is saved', async t => {
  const { request, url, dataFile } = await serverFixture(t);
  const controller = new AbortController();
  const response = await fetch(`${url}/api/events?user=me`, { signal: controller.signal });
  const reader = response.body.getReader();
  t.after(async () => { controller.abort(); await reader.cancel().catch(() => {}); });
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: ready/);

  const deletion = request('DELETE', '/api/friends/hana');
  const timer = setTimeout(() => controller.abort(), 3000);
  let change;
  try { change = await reader.read(); }
  finally { clearTimeout(timer); }
  assert.match(decoder.decode(change.value), /event: change/);
  const saved = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(saved.friendships.some(edge => edge.ownerId === 'me' && edge.userId === 'hana'), false);
  assert.equal((await deletion).status, 200);
  assert.equal((await request('GET', '/api/bootstrap')).body.friends.some(friend => friend.id === 'hana'), false);
});

test('failed friend deletion preserves memory and disk without notifying, then the write queue recovers', async t => {
  const { dataFile, directory } = await temporaryState(t);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  await store.setFriendHidden('me', 'hana', true);
  notifications.length = 0;
  const original = await readFile(dataFile, 'utf8');
  const before = store.bootstrap('me');
  const backup = `${dataFile}.backup`;
  await rename(dataFile, backup);
  await mkdir(dataFile);

  await assert.rejects(store.deleteFriend('me', 'hana'));
  assert.deepEqual(store.bootstrap('me'), before);
  assert.equal(await readFile(backup, 'utf8'), original);
  assert.deepEqual(notifications, []);
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), []);

  await rm(dataFile, { recursive: true });
  await rename(backup, dataFile);
  assert.deepEqual(await store.deleteFriend('me', 'hana'), { userId: 'hana', deleted: true });
  assert.deepEqual(notifications, [['me']]);
  const reopened = await MessengerStore.open(dataFile);
  assert.equal(reopened.bootstrap('me').friends.some(friend => friend.id === 'hana'), false);
});
