import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessengerStore, seedState } from '../server/store.mjs';
import { startServer } from '../server/index.mjs';

const testRoot = fileURLToPath(new URL('../test-results/', import.meta.url));

async function temporaryState(t) {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'katok-block-'));
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

const hasFriend = (store, owner, target) => store.bootstrap(owner).friends.some(friend => friend.id === target);
const blockedIds = (store, owner) => store.bootstrap(owner).blockedUsers.map(user => user.id);
const canSend = (store, owner, roomId = 'demo-direct') => store.bootstrap(owner).rooms.find(room => room.id === roomId).canSend;

test('blocking a hidden friend durably removes only my friendship and preserves conversations and read cursors', async t => {
  const { dataFile } = await temporaryState(t);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  const group = await store.createRoom('me', ['hana', 'jun'], '차단 뒤에도 남는 방');
  await store.sendMessage('hana', group.id, '그룹의 기존 메시지', 'before-block');
  await store.markRead('me', group.id, 1);
  await store.markRead('me', 'demo-direct', 1);
  await store.setFriendHidden('me', 'hana', true);
  const before = JSON.parse(await readFile(dataFile, 'utf8'));
  notifications.length = 0;

  assert.deepEqual(await store.blockUser('me', 'hana'), { userId: 'hana', blocked: true, changed: true });
  assert.deepEqual(notifications.map(ids => ids.sort()), [['hana', 'me']]);
  const after = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(after.version, 1);
  assert.deepEqual(after.blocks, [{ ownerId: 'me', userId: 'hana' }]);
  assert.deepEqual(after.friendships, before.friendships.filter(edge => !(edge.ownerId === 'me' && edge.userId === 'hana')));
  for (const key of ['users', 'rooms', 'messages']) assert.deepEqual(after[key], before[key]);
  assert.equal(hasFriend(store, 'me', 'hana'), false);
  assert.equal(hasFriend(store, 'hana', 'me'), true);
  assert.deepEqual(blockedIds(store, 'me'), ['hana']);
  assert.deepEqual(blockedIds(store, 'hana'), []);
  assert.equal(canSend(store, 'me'), false);
  assert.equal(canSend(store, 'hana'), false);
  assert.equal(canSend(store, 'me', group.id), true);

  const reopened = await MessengerStore.open(dataFile);
  for (const owner of ['me', 'hana']) assert.deepEqual(reopened.bootstrap(owner), store.bootstrap(owner));
  assert.deepEqual(reopened.messages('demo-direct', 'me'), store.messages('demo-direct', 'me'));
  assert.deepEqual(reopened.messages(group.id, 'me'), store.messages(group.id, 'me'));
});

test('block APIs validate target IDs, allow nonfriends, and never remove a block through friendship operations', async t => {
  const { request, dataFile } = await serverFixture(t);
  const before = await readFile(dataFile, 'utf8');
  for (const userId of [undefined, null, '', '  ', 7, {}, [], 'me']) {
    assert.equal((await request('POST', '/api/blocks', { userId })).status, 400);
  }
  assert.equal((await request('POST', '/api/blocks', { userId: 'missing' })).status, 404);
  assert.equal((await request('POST', '/api/blocks', { userId: 'hana' }, 'missing')).status, 404);
  for (const path of ['/api/blocks/me', '/api/blocks/%20%20', '/api/blocks/%ZZ']) {
    assert.equal((await request('DELETE', path)).status, 400);
  }
  assert.equal((await request('DELETE', '/api/blocks/missing')).status, 404);
  assert.equal((await request('DELETE', '/api/blocks/hana', undefined, 'missing')).status, 404);
  assert.equal(await readFile(dataFile, 'utf8'), before);

  const blocked = await request('POST', '/api/blocks', { userId: 'sora' });
  assert.equal(blocked.status, 200);
  assert.deepEqual(blocked.body, { userId: 'sora', blocked: true, changed: true });
  assert.deepEqual((await request('POST', '/api/blocks', { userId: 'sora' })).body, { userId: 'sora', blocked: true, changed: false });
  assert.equal((await request('POST', '/api/friends', { userId: 'sora' })).status, 409);
  assert.equal((await request('PATCH', '/api/friends/sora', { hidden: false })).status, 404);
  assert.deepEqual((await request('DELETE', '/api/friends/sora')).body, { userId: 'sora', deleted: false });
  assert.deepEqual((await request('GET', '/api/bootstrap')).body.blockedUsers.map(user => user.id), ['sora']);
  assert.deepEqual((await request('GET', '/api/bootstrap', undefined, 'sora')).body.blockedUsers, []);
  assert.equal((await request('POST', '/api/rooms', { memberIds: ['sora'] })).status, 403);
  assert.equal((await request('POST', '/api/rooms', { memberIds: ['me'] }, 'sora')).status, 403);

  const unblocked = await request('DELETE', '/api/blocks/sora');
  assert.equal(unblocked.status, 200);
  assert.deepEqual(unblocked.body, { userId: 'sora', blocked: false, changed: true });
  assert.deepEqual((await request('DELETE', '/api/blocks/sora')).body, { userId: 'sora', blocked: false, changed: false });
  assert.equal((await request('GET', '/api/bootstrap')).body.friends.some(friend => friend.id === 'sora'), false);
  assert.equal((await request('POST', '/api/friends', { userId: 'sora' })).status, 201);
});

test('blocked direct chats reject new sends and room reuse but keep history, reading, and committed retries', async t => {
  const { request, store, dataFile } = await serverFixture(t);
  const path = '/api/rooms/demo-direct';
  const sent = await request('POST', `${path}/messages`, { text: '응답이 유실된 메시지', clientId: 'committed-retry' });
  assert.equal(sent.status, 201);
  await request('POST', '/api/blocks', { userId: 'hana' });
  const before = await readFile(dataFile, 'utf8');
  const history = (await request('GET', `${path}/messages`)).body;
  for (const user of ['me', 'hana']) {
    assert.equal((await request('POST', `${path}/messages`, { text: '차단 중 새 메시지', clientId: `blocked-${user}` }, user)).status, 403);
    assert.equal((await request('POST', '/api/rooms', { memberIds: [user === 'me' ? 'hana' : 'me'] }, user)).status, 403);
    assert.equal(canSend(store, user), false);
  }
  const retry = await request('POST', `${path}/messages`, { text: '  응답이 유실된 메시지  ', clientId: 'committed-retry' });
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, sent.body);
  assert.equal((await request('POST', `${path}/messages`, { text: '요청 ID 재사용 공격', clientId: 'committed-retry' })).status, 409);
  assert.equal(await readFile(dataFile, 'utf8'), before);
  assert.deepEqual((await request('GET', `${path}/messages`)).body, history);
  assert.equal((await request('POST', `${path}/read`, { sequence: 2 }, 'hana')).status, 200);
  assert.equal((await request('GET', `${path}/messages`)).body.messages.at(-1).unreadCount, 0);

  await request('DELETE', '/api/blocks/hana');
  const next = await request('POST', `${path}/messages`, { text: '해제 뒤 순번', clientId: 'after-unblock' });
  assert.equal(next.status, 201);
  assert.equal(next.body.sequence, sent.body.sequence + 1);
});

test('each side owns its block; unblocking does not restore friendship or bypass the other side', async t => {
  const { dataFile } = await temporaryState(t);
  let store = await MessengerStore.open(dataFile);
  await store.blockUser('me', 'hana');
  await store.blockUser('hana', 'me');
  assert.deepEqual(blockedIds(store, 'me'), ['hana']);
  assert.deepEqual(blockedIds(store, 'hana'), ['me']);
  assert.equal(hasFriend(store, 'me', 'hana'), false);
  assert.equal(hasFriend(store, 'hana', 'me'), false);

  await store.unblockUser('me', 'hana');
  assert.equal(hasFriend(store, 'me', 'hana'), false);
  assert.deepEqual(blockedIds(store, 'me'), []);
  assert.deepEqual(blockedIds(store, 'hana'), ['me']);
  assert.equal(canSend(store, 'me'), false);
  await assert.rejects(store.sendMessage('me', 'demo-direct', '상대 차단이 남아 있음', 'reverse-block'), error => error.status === 403);
  assert.equal((await store.addFriend('me', 'hana')).hidden, false);
  await assert.rejects(store.createRoom('me', ['hana']), error => error.status === 403);

  store = await MessengerStore.open(dataFile);
  assert.equal(canSend(store, 'hana'), false);
  await store.unblockUser('hana', 'me');
  assert.equal(hasFriend(store, 'hana', 'me'), false);
  assert.equal(canSend(store, 'me'), true);
  assert.equal(canSend(store, 'hana'), true);
  assert.equal((await store.createRoom('me', ['hana'])).id, 'demo-direct');
  assert.equal((await store.sendMessage('hana', 'demo-direct', '양쪽 해제 완료', 'both-unblocked')).sequence, 2);
  const reopened = await MessengerStore.open(dataFile);
  assert.deepEqual(blockedIds(reopened, 'me'), []);
  assert.deepEqual(blockedIds(reopened, 'hana'), []);
  assert.equal(hasFriend(reopened, 'hana', 'me'), false);
});

test('existing groups keep full delivery and read counts, while new groups reject only the creator-owned blocked targets', async t => {
  const { dataFile } = await temporaryState(t);
  const store = await MessengerStore.open(dataFile);
  const group = await store.createRoom('me', ['hana', 'jun']);
  await store.blockUser('me', 'hana');
  const before = await readFile(dataFile, 'utf8');
  await assert.rejects(store.createRoom('me', ['hana', 'sora']), error => error.status === 403);
  assert.equal(await readFile(dataFile, 'utf8'), before);
  const reverseGroup = await store.createRoom('hana', ['me', 'sora']);
  assert.equal(reverseGroup.type, 'group');
  const thirdPartyGroup = await store.createRoom('jun', ['me', 'hana']);
  assert.equal(thirdPartyGroup.type, 'group');
  await store.blockUser('hana', 'me');

  for (const user of ['me', 'hana', 'jun']) assert.equal(canSend(store, user, group.id), true);
  const incoming = await store.sendMessage('hana', group.id, '차단 관계가 있어도 그룹 수신', 'group-incoming');
  assert.equal(incoming.unreadCount, 2);
  assert.equal(store.bootstrap('me').rooms.find(room => room.id === group.id).unreadCount, 1);
  assert.equal(store.messages(group.id, 'me').messages.at(-1).text, incoming.text);
  const reply = await store.sendMessage('me', group.id, '그룹 답장', 'group-reply');
  assert.equal(reply.unreadCount, 2);
  await store.markRead('me', group.id, incoming.sequence);
  assert.equal(store.messages(group.id, 'hana').messages[0].unreadCount, 1);
  await store.markRead('jun', group.id, reply.sequence);
  assert.deepEqual(store.messages(group.id, 'me').messages.map(message => message.unreadCount), [0, 1]);
});

test('concurrent block requests are idempotent and no-op block or unblock requests do not write or notify', async t => {
  const { dataFile } = await temporaryState(t);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  const blocked = await Promise.all(Array.from({ length: 4 }, () => store.blockUser('me', 'hana')));
  assert.equal(blocked.filter(result => result.changed).length, 1);
  assert.ok(blocked.every(result => result.blocked && result.userId === 'hana'));
  assert.equal(notifications.length, 1);
  const original = await readFile(dataFile, 'utf8');
  const backup = `${dataFile}.backup`;
  await rename(dataFile, backup);
  await mkdir(dataFile);
  // An attempted save would fail while the destination is an existing directory.
  assert.deepEqual(await store.blockUser('me', 'hana'), { userId: 'hana', blocked: true, changed: false });
  assert.deepEqual(await store.unblockUser('me', 'sora'), { userId: 'sora', blocked: false, changed: false });
  assert.equal(notifications.length, 1);
  assert.equal(await readFile(backup, 'utf8'), original);
  await rm(dataFile, { recursive: true });
  await rename(backup, dataFile);
  const unblocked = await Promise.all(Array.from({ length: 4 }, () => store.unblockUser('me', 'hana')));
  assert.equal(unblocked.filter(result => result.changed).length, 1);
  assert.ok(unblocked.every(result => !result.blocked && result.userId === 'hana'));
  assert.equal(notifications.length, 2);
});

test('legacy version 1 opens without rewriting and adds blocks only with the next saved change', async t => {
  const { dataFile } = await temporaryState(t);
  const legacy = seedState();
  delete legacy.blocks;
  const original = JSON.stringify(legacy);
  await writeFile(dataFile, original);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  assert.deepEqual(blockedIds(store, 'me'), []);
  assert.equal(canSend(store, 'me'), true);
  assert.equal(await readFile(dataFile, 'utf8'), original);
  await store.unblockUser('me', 'hana');
  assert.equal(await readFile(dataFile, 'utf8'), original);
  assert.deepEqual(notifications, []);
  await store.blockUser('me', 'hana');
  const saved = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.blocks, [{ ownerId: 'me', userId: 'hana' }]);
  for (const key of ['users', 'rooms', 'messages']) assert.deepEqual(saved[key], legacy[key]);
  assert.deepEqual(blockedIds(await MessengerStore.open(dataFile), 'me'), ['hana']);
});

test('invalid explicit blocks reject startup and preserve the original file', async t => {
  const { dataFile } = await temporaryState(t);
  const invalidBlocks = [
    null,
    {},
    'invalid',
    [null],
    [{}],
    [{ ownerId: 'me', userId: 'me' }],
    [{ ownerId: 'missing', userId: 'sora' }],
    [{ ownerId: 'me', userId: 'missing' }],
    [{ ownerId: 'me', userId: 'sora' }, { ownerId: 'me', userId: 'sora' }],
    [{ ownerId: 'me', userId: 'hana' }], // Same directed friendship and block cannot coexist.
  ];
  for (const blocks of invalidBlocks) {
    const content = JSON.stringify({ ...seedState(), blocks });
    await writeFile(dataFile, content);
    await assert.rejects(MessengerStore.open(dataFile), /보존/);
    assert.equal(await readFile(dataFile, 'utf8'), content);
  }
  // The reverse friendship is valid and must not be mistaken for an overlap.
  const valid = seedState();
  valid.friendships = valid.friendships.filter(edge => !(edge.ownerId === 'me' && edge.userId === 'hana'));
  valid.blocks = [{ ownerId: 'me', userId: 'hana' }];
  await writeFile(dataFile, JSON.stringify(valid));
  const store = await MessengerStore.open(dataFile);
  assert.equal(hasFriend(store, 'hana', 'me'), true);
  assert.deepEqual(blockedIds(store, 'me'), ['hana']);
});

test('failed block and unblock writes preserve memory and disk without notification, then recover', async t => {
  const { directory, dataFile } = await temporaryState(t);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  await store.setFriendHidden('me', 'hana', true);
  for (const method of ['blockUser', 'unblockUser']) {
    notifications.length = 0;
    const before = Object.fromEntries(['me', 'hana'].map(user => [user, store.bootstrap(user)]));
    const original = await readFile(dataFile, 'utf8');
    const backup = `${dataFile}.backup`;
    await rename(dataFile, backup);
    await mkdir(dataFile);
    await assert.rejects(store[method]('me', 'hana'));
    for (const user of ['me', 'hana']) assert.deepEqual(store.bootstrap(user), before[user]);
    assert.equal(await readFile(backup, 'utf8'), original);
    assert.deepEqual(notifications, []);
    assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.tmp')), []);
    await rm(dataFile, { recursive: true });
    await rename(backup, dataFile);
    assert.equal((await store[method]('me', 'hana')).changed, true);
    assert.deepEqual(notifications.map(ids => ids.sort()), [['hana', 'me']]);
    const reopened = await MessengerStore.open(dataFile);
    for (const user of ['me', 'hana']) assert.deepEqual(reopened.bootstrap(user), store.bootstrap(user));
  }
  assert.equal(hasFriend(store, 'me', 'hana'), false);
  assert.equal(canSend(store, 'me'), true);
});

test('SSE notifies both users after block and unblock state is saved', async t => {
  const { request, url, dataFile } = await serverFixture(t);
  const streams = [];
  const decoder = new TextDecoder();
  try {
    for (const user of ['me', 'hana']) {
      const controller = new AbortController();
      const response = await fetch(`${url}/api/events?user=${user}`, { signal: controller.signal });
      const reader = response.body.getReader();
      streams.push({ controller, reader });
      assert.match(decoder.decode((await reader.read()).value), /event: ready/);
    }
    for (const blocked of [true, false]) {
      const changes = streams.map(async ({ controller, reader }) => {
        const timer = setTimeout(() => controller.abort(), 3000);
        try { assert.match(decoder.decode((await reader.read()).value), /event: change/); }
        finally { clearTimeout(timer); }
        const saved = JSON.parse(await readFile(dataFile, 'utf8'));
        assert.equal(saved.blocks.some(edge => edge.ownerId === 'me' && edge.userId === 'hana'), blocked);
      });
      const mutation = blocked ? request('POST', '/api/blocks', { userId: 'hana' }) : request('DELETE', '/api/blocks/hana');
      await Promise.all([...changes, mutation.then(result => assert.equal(result.status, 200))]);
      for (const user of ['me', 'hana']) {
        const state = (await request('GET', '/api/bootstrap', undefined, user)).body;
        assert.equal(state.rooms.find(room => room.id === 'demo-direct').canSend, !blocked);
      }
    }
  } finally {
    for (const { controller, reader } of streams) {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  }
});

test('the write queue defines the send/block boundary without lost messages, sequence gaps, or forbidden-send notifications', async t => {
  const { dataFile } = await temporaryState(t);
  const notifications = [];
  const store = await MessengerStore.open(dataFile, ids => notifications.push([...ids]));
  const group = await store.createRoom('me', ['hana', 'jun']);
  notifications.length = 0;
  const results = await Promise.allSettled([
    store.sendMessage('hana', 'demo-direct', '차단보다 먼저 큐에 들어온 메시지', 'before-boundary'),
    store.blockUser('me', 'hana'),
    store.sendMessage('me', 'demo-direct', '차단 뒤의 메시지', 'during-boundary'),
    store.sendMessage('hana', group.id, '계속 받는 그룹 메시지', 'group-boundary'),
    store.unblockUser('me', 'hana'),
    store.sendMessage('me', 'demo-direct', '해제보다 뒤에 들어온 메시지', 'after-boundary'),
  ]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal(results[2].reason.status, 403);
  assert.equal(notifications.length, 5);
  const messages = store.messages('demo-direct', 'me').messages;
  assert.deepEqual(messages.map(message => message.sequence), [1, 2, 3]);
  assert.deepEqual(messages.map(message => message.clientId), ['demo-welcome', 'before-boundary', 'after-boundary']);
  assert.equal(store.messages(group.id, 'me').messages.length, 1);
  assert.deepEqual(blockedIds(store, 'me'), []);
  assert.equal(hasFriend(store, 'me', 'hana'), false);
  const saved = await readFile(dataFile, 'utf8');
  const reopened = await MessengerStore.open(dataFile);
  assert.deepEqual(reopened.messages('demo-direct', 'me'), store.messages('demo-direct', 'me'));
  assert.deepEqual(reopened.messages(group.id, 'me'), store.messages(group.id, 'me'));
  assert.equal(await readFile(dataFile, 'utf8'), saved);
});
