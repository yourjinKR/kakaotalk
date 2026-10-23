import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const check = (condition, status, message) => {
  if (!condition) throw new ApiError(status, message);
};
const now = () => new Date().toISOString();

export function seedState() {
  const createdAt = now();
  return {
    version: 1,
    users: [
      { id: 'me', displayName: '나', statusMessage: '카톡을 만들어 보는 중' },
      { id: 'hana', displayName: '김하나', statusMessage: '오늘도 좋은 하루' },
      { id: 'jun', displayName: '이준', statusMessage: '천천히, 꾸준히' },
      { id: 'sora', displayName: '박소라', statusMessage: '새로운 시작' },
    ],
    friendships: [
      { ownerId: 'me', userId: 'hana', hidden: false },
      { ownerId: 'me', userId: 'jun', hidden: false },
      { ownerId: 'hana', userId: 'me', hidden: false },
      { ownerId: 'jun', userId: 'me', hidden: false },
    ],
    rooms: [{
      id: 'demo-direct', type: 'direct', title: '', memberIds: ['me', 'hana'],
      createdAt, updatedAt: createdAt, readCursors: { me: 0, hana: 1 },
    }],
    messages: [{
      id: 'demo-message', sequence: 1, roomId: 'demo-direct', senderId: 'hana',
      text: '안녕하세요! 이곳은 합성 계정으로 대화하는 로컬 데모예요.',
      createdAt, clientId: 'demo-welcome',
    }],
  };
}

// Refuse corrupt or incompatible data instead of silently replacing a user's work.
function validateState(state) {
  const invalid = () => { throw new Error('저장 데이터가 손상되었거나 지원하지 않는 형식입니다. 기존 파일을 보존했습니다.'); };
  if (!state || state.version !== 1 || !['users', 'friendships', 'rooms', 'messages'].every(key => Array.isArray(state[key]))) invalid();
  const unique = values => new Set(values).size === values.length;
  const string = value => typeof value === 'string';
  const date = value => string(value) && Number.isFinite(Date.parse(value));
  if (!state.users.length || !unique(state.users.map(user => user?.id))) invalid();
  if (!state.users.every(user => user && string(user.id) && user.id && string(user.displayName) && string(user.statusMessage))) invalid();
  const users = new Set(state.users.map(user => user.id));
  if (!unique(state.friendships.map(edge => `${edge?.ownerId}:${edge?.userId}`))) invalid();
  if (!state.friendships.every(edge => edge && users.has(edge.ownerId) && users.has(edge.userId) && edge.ownerId !== edge.userId && typeof edge.hidden === 'boolean')) invalid();
  if (!unique(state.rooms.map(room => room?.id))) invalid();
  for (const room of state.rooms) {
    if (!room || !string(room.id) || !room.id || !['direct', 'group'].includes(room.type) || !string(room.title) || !Array.isArray(room.memberIds) || !unique(room.memberIds) || !room.memberIds.every(id => users.has(id))) invalid();
    if ((room.type === 'direct' && room.memberIds.length !== 2) || (room.type === 'group' && room.memberIds.length < 3)) invalid();
    if (!date(room.createdAt) || !date(room.updatedAt) || !room.readCursors || Array.isArray(room.readCursors)) invalid();
    if (Object.keys(room.readCursors).length !== room.memberIds.length || !room.memberIds.every(id => Number.isSafeInteger(room.readCursors[id]) && room.readCursors[id] >= 0)) invalid();
  }
  if (!unique(state.messages.map(message => message?.id))) invalid();
  const roomMap = new Map(state.rooms.map(room => [room.id, room]));
  const nextSequences = new Map();
  const clientKeys = new Set();
  for (const message of state.messages) {
    if (!message || !string(message.id) || !message.id || !string(message.text) || !message.text.trim() || message.text.length > 4000 || !date(message.createdAt) || !string(message.clientId) || !message.clientId || message.clientId.length > 128) invalid();
    const room = roomMap.get(message.roomId);
    if (!room || !room.memberIds.includes(message.senderId) || message.sequence !== (nextSequences.get(room.id) ?? 0) + 1) invalid();
    nextSequences.set(room.id, message.sequence);
    const key = JSON.stringify([room.id, message.senderId, message.clientId]);
    if (clientKeys.has(key)) invalid();
    clientKeys.add(key);
  }
  for (const room of state.rooms) {
    if (!room.memberIds.every(id => room.readCursors[id] <= (nextSequences.get(room.id) ?? 0))) invalid();
  }
}

export class MessengerStore {
  #state;
  #file;
  #queue = Promise.resolve();
  #onChange = () => {};

  static async open(file, onChange = () => {}) {
    const store = new MessengerStore();
    store.#file = file;
    store.#onChange = onChange;
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`저장 데이터를 열 수 없습니다. 기존 파일을 보존했습니다: ${error.message}`, { cause: error });
      state = seedState();
      await store.#persist(state);
    }
    validateState(state);
    store.#state = state;
    return store;
  }

  async #persist(state) {
    await mkdir(dirname(this.#file), { recursive: true });
    const temporary = `${this.#file}.${process.pid}.${randomUUID()}.tmp`;
    // Exclusive creation establishes ownership before any failure cleanup.
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await handle.close();
      // Windows scanners can briefly hold the destination between serialized writes.
      // Retry only sharing/access errors, retaining the original on final failure.
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, this.#file); break; }
        catch (error) {
          if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
          await delay(25 * 2 ** attempt);
        }
      }
    } catch (error) {
      await handle.close().catch(() => {});
      await unlink(temporary).catch(cleanupError => {
        if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError;
      });
      throw error;
    }
  }

  #mutate(operation) {
    const pending = this.#queue.then(async () => {
      const draft = structuredClone(this.#state);
      const result = operation(draft);
      if (result.changed) {
        await this.#persist(draft);
        this.#state = draft;
        this.#onChange(result.notifyUserIds ?? draft.users.map(user => user.id));
      }
      return result.value;
    });
    // A rejected write must not poison the transaction queue.
    this.#queue = pending.catch(() => {});
    return pending;
  }

  user(id, state = this.#state) {
    const user = state.users.find(candidate => candidate.id === id);
    check(user, 404, '데모 사용자를 찾을 수 없습니다.');
    return user;
  }

  #room(id, userId, state = this.#state) {
    this.user(userId, state);
    const room = state.rooms.find(candidate => candidate.id === id);
    check(room, 404, '채팅방을 찾을 수 없습니다.');
    check(room.memberIds.includes(userId), 403, '이 채팅방의 참여자가 아닙니다.');
    return room;
  }

  #messageView(message, room) {
    return {
      ...message,
      unreadCount: room.memberIds.filter(id => id !== message.senderId && room.readCursors[id] < message.sequence).length,
    };
  }

  #roomView(room, userId, state = this.#state) {
    const messages = state.messages.filter(message => message.roomId === room.id);
    const lastMessage = messages.at(-1);
    return {
      id: room.id, type: room.type, title: room.title, memberIds: [...room.memberIds],
      createdAt: room.createdAt, updatedAt: room.updatedAt,
      lastMessage: lastMessage ? this.#messageView(lastMessage, room) : null,
      unreadCount: messages.filter(message => message.senderId !== userId && message.sequence > room.readCursors[userId]).length,
    };
  }

  bootstrap(userId) {
    const state = this.#state;
    return {
      currentUser: { ...this.user(userId) },
      users: structuredClone(state.users),
      friends: state.friendships.filter(edge => edge.ownerId === userId).map(edge => ({ ...this.user(edge.userId), hidden: edge.hidden })),
      rooms: state.rooms.filter(room => room.memberIds.includes(userId)).map(room => this.#roomView(room, userId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
      mode: 'localhost-demo',
    };
  }

  messages(roomId, userId) {
    const room = this.#room(roomId, userId);
    return {
      messages: this.#state.messages.filter(message => message.roomId === roomId).map(message => this.#messageView(message, room)),
      readSequence: room.readCursors[userId],
    };
  }

  addFriend(userId, friendId) {
    return this.#mutate(state => {
      this.user(userId, state);
      check(typeof friendId === 'string' && friendId.trim(), 400, '추가할 친구 ID가 필요합니다.');
      check(friendId !== userId, 400, '자신을 친구로 추가할 수 없습니다.');
      const friend = this.user(friendId, state);
      const existing = state.friendships.find(edge => edge.ownerId === userId && edge.userId === friendId);
      check(!existing, 409, existing?.hidden ? '숨긴 친구입니다. 숨김 목록에서 복귀해 주세요.' : '이미 등록된 친구입니다.');
      state.friendships.push({ ownerId: userId, userId: friendId, hidden: false });
      return { changed: true, value: { ...friend, hidden: false }, notifyUserIds: [userId] };
    });
  }

  setFriendHidden(userId, friendId, hidden) {
    return this.#mutate(state => {
      this.user(userId, state);
      check(typeof hidden === 'boolean', 400, 'hidden 값은 참 또는 거짓이어야 합니다.');
      const friendship = state.friendships.find(edge => edge.ownerId === userId && edge.userId === friendId);
      check(friendship, 404, '등록된 친구를 찾을 수 없습니다.');
      const changed = friendship.hidden !== hidden;
      friendship.hidden = hidden;
      return { changed, value: { ...this.user(friendId, state), hidden }, notifyUserIds: [userId] };
    });
  }

  deleteFriend(userId, friendId) {
    return this.#mutate(state => {
      this.user(userId, state);
      check(typeof friendId === 'string' && friendId.trim(), 400, '삭제할 친구 ID가 필요합니다.');
      check(friendId !== userId, 400, '자신을 친구에서 삭제할 수 없습니다.');
      this.user(friendId, state);
      const index = state.friendships.findIndex(edge => edge.ownerId === userId && edge.userId === friendId);
      const deleted = index !== -1;
      // Friendship removal leaves the other direction and conversation state intact.
      if (deleted) state.friendships.splice(index, 1);
      return { changed: deleted, value: { userId: friendId, deleted }, notifyUserIds: [userId] };
    });
  }

  createRoom(userId, memberIds, title = '') {
    return this.#mutate(state => {
      this.user(userId, state);
      check(Array.isArray(memberIds) && memberIds.length > 0 && memberIds.length <= 20 && memberIds.every(id => typeof id === 'string'), 400, '참여자 ID 목록이 필요합니다.');
      check(typeof title === 'string' && title.trim().length <= 100, 400, '채팅방 이름은 100자 이하로 입력해 주세요.');
      const participants = [...new Set([userId, ...memberIds])];
      check(participants.length >= 2, 400, '다른 참여자를 한 명 이상 선택해 주세요.');
      for (const id of participants) this.user(id, state);
      if (participants.length === 2) {
        const existing = state.rooms.find(room => room.type === 'direct' && room.memberIds.length === 2 && participants.every(id => room.memberIds.includes(id)));
        if (existing) return { changed: false, value: this.#roomView(existing, userId, state) };
      }
      const createdAt = now();
      const room = {
        id: randomUUID(), type: participants.length === 2 ? 'direct' : 'group',
        title: participants.length === 2 ? '' : title.trim(), memberIds: participants,
        createdAt, updatedAt: createdAt,
        readCursors: Object.fromEntries(participants.map(id => [id, 0])),
      };
      state.rooms.push(room);
      return { changed: true, value: this.#roomView(room, userId, state), notifyUserIds: participants };
    });
  }

  sendMessage(userId, roomId, text, clientId = randomUUID()) {
    return this.#mutate(state => {
      const room = this.#room(roomId, userId, state);
      check(typeof text === 'string' && text.trim().length > 0 && text.length <= 4000, 400, '메시지는 1~4000자로 입력해 주세요.');
      check(typeof clientId === 'string' && clientId.trim().length > 0 && clientId.length <= 128, 400, '올바른 메시지 요청 ID가 필요합니다.');
      const existing = state.messages.find(message => message.roomId === roomId && message.senderId === userId && message.clientId === clientId);
      if (existing) {
        check(existing.text === text.trim(), 409, '같은 요청 ID로 다른 메시지를 보낼 수 없습니다.');
        return { changed: false, value: this.#messageView(existing, room) };
      }
      const previous = state.messages.filter(message => message.roomId === roomId).at(-1);
      const message = {
        id: randomUUID(), sequence: (previous?.sequence ?? 0) + 1, roomId, senderId: userId,
        text: text.trim(), createdAt: now(), clientId,
      };
      state.messages.push(message);
      room.updatedAt = message.createdAt;
      // Sending does not prove that earlier incoming messages were rendered.
      // Only an explicit markRead call advances a participant's read cursor.
      return { changed: true, value: this.#messageView(message, room), notifyUserIds: room.memberIds };
    });
  }

  markRead(userId, roomId, sequence) {
    return this.#mutate(state => {
      const room = this.#room(roomId, userId, state);
      const latest = state.messages.filter(message => message.roomId === roomId).at(-1)?.sequence ?? 0;
      check(Number.isSafeInteger(sequence) && sequence >= 0 && sequence <= latest, 400, '존재하는 메시지의 읽음 위치가 필요합니다.');
      const cursor = Math.max(room.readCursors[userId], sequence);
      const changed = cursor !== room.readCursors[userId];
      room.readCursors[userId] = cursor;
      return { changed, value: { sequence: cursor }, notifyUserIds: room.memberIds };
    });
  }
}
