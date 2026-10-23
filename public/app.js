const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const state = {
  user: new URLSearchParams(location.search).get('user') || 'me', epoch: 0, relationshipRevision: 0,
  data: null, mode: 'friends', friend: null, room: null, messages: [], readSequence: 0,
  query: '', selected: new Set(), drafts: new Map(), pending: new Map(), sending: new Set(),
  source: null, refreshing: null, dirty: false, readPending: new Set(), deletion: null, creating: null, blocking: null,
};
if (!['me', 'hana', 'jun', 'sora'].includes(state.user)) state.user = 'me';
const keyFor = (user, room) => `${user}:${room}`;
const userById = id => state.data?.users.find(user => user.id === id) || { id, displayName: id, statusMessage: '' };
const roomById = id => state.data?.rooms.find(room => room.id === id);
const isBlocked = id => state.data?.blockedUsers.some(user => user.id === id);
const canSend = () => roomById(state.room)?.canSend === true;
const roomName = room => room.title || room.memberIds.filter(id => id !== state.user).map(id => userById(id).displayName).join(', ');
const matches = (value, query) => value.toLocaleLowerCase('ko').includes(query.trim().toLocaleLowerCase('ko'));
const time = value => value ? new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
const avatar = (user, extra = '') => `<span class="avatar tone-${['me', 'hana', 'jun', 'sora'].indexOf(user.id)} ${extra}" aria-hidden="true">${escape(user.displayName.slice(0, 1))}</span>`;
const roomAvatar = room => room.type === 'group' ? `<span class="avatar group-avatar" aria-hidden="true">${room.memberIds.length}</span>` : avatar(userById(room.memberIds.find(id => id !== state.user)));

let toastTimer;
function toast(message, error = false) {
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
async function api(path, { method = 'GET', body, user = state.user } = {}) {
  const response = await fetch(`${path}?user=${encodeURIComponent(user)}`, {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
  return result;
}
function connected(yes) {
  $('connection-dot').classList.toggle('connected', yes);
  $('connection-status').textContent = yes ? '연결됨' : '재연결 중';
}
function connect() {
  state.source?.close();
  const epoch = state.epoch;
  const source = new EventSource(`/api/events?user=${encodeURIComponent(state.user)}`);
  state.source = source;
  source.addEventListener('ready', () => { if (epoch === state.epoch) { connected(true); refresh(); } });
  source.addEventListener('change', () => { if (epoch === state.epoch) refresh(); });
  source.onerror = () => { if (epoch === state.epoch) connected(false); };
}
// Coalesce SSE invalidations and never allow an older account/room response to render.
function refresh() {
  state.dirty = true;
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    while (state.dirty) {
      state.dirty = false;
      const epoch = state.epoch;
      const user = state.user;
      const relationshipRevision = state.relationshipRevision;
      try {
        const data = await api('/api/bootstrap', { user });
        if (epoch !== state.epoch) continue;
        if (relationshipRevision !== state.relationshipRevision) { state.dirty = true; continue; }
        state.data = data;
        reconcileFriends();
        renderLists();
        renderAccount();
        if ($('manage-dialog').open) renderHidden();
        if ($('members-dialog').open) renderMembers();
        updateSendButton();
        if (state.room) {
          const roomId = state.room;
          const result = await api(`/api/rooms/${encodeURIComponent(roomId)}/messages`, { user });
          if (epoch !== state.epoch || state.room !== roomId) continue;
          state.messages = result.messages;
          state.readSequence = result.readSequence;
          renderMessages();
          markVisibleRead();
        } else if (state.friend) renderProfile();
      } catch (error) {
        if (epoch !== state.epoch) continue;
        connected(false);
        if (!state.data) $('list-content').innerHTML = `<div class="server-error">${escape(error.message)}<br><button class="button secondary" data-action="retry">다시 연결</button></div>`;
        else toast(error.message, true);
      }
    }
  })().finally(() => { state.refreshing = null; });
  return state.refreshing;
}
function renderAccount() {
  $('account-select').innerHTML = state.data.users.map(user => `<option value="${escape(user.id)}">${escape(user.displayName)} (${escape(user.id)})</option>`).join('');
  $('account-select').value = state.user;
  $('rail-user').textContent = state.data.currentUser.displayName.slice(0, 1);
  $('open-session').href = `/?user=${state.user === 'me' ? 'hana' : 'me'}`;
  $('open-session').title = `${state.user === 'me' ? '김하나' : '나'}의 별도 창에서 대화 확인`;
  const count = state.data.rooms.reduce((sum, room) => sum + room.unreadCount, 0);
  $('chat-unread-total').hidden = count === 0;
  $('chat-unread-total').textContent = count > 99 ? '99+' : count;
  document.title = `${count ? `(${count}) ` : ''}카톡 — 가까운 대화`;
}
function renderLists() {
  if (!state.data) return;
  const friendsMode = state.mode === 'friends';
  $('nav-friends').classList.toggle('active', friendsMode);
  $('nav-chats').classList.toggle('active', !friendsMode);
  for (const id of ['nav-friends', 'nav-chats']) $(id).removeAttribute('aria-current');
  $(friendsMode ? 'nav-friends' : 'nav-chats').setAttribute('aria-current', 'page');
  $('list-eyebrow').textContent = friendsMode ? 'PEOPLE' : 'CONVERSATIONS';
  $('list-action').setAttribute('aria-label', friendsMode ? '친구 추가' : '새 채팅');
  $('list-search').placeholder = friendsMode ? '이름 또는 ID 검색' : '채팅방 또는 참여자 검색';
  $('list-search').setAttribute('aria-label', $('list-search').placeholder);
  const friends = state.data.friends.filter(friend => !friend.hidden).sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'));
  $('list-title').innerHTML = `${friendsMode ? '친구' : '채팅'} <span>${friendsMode ? friends.length : state.data.rooms.length}</span>`;
  if (friendsMode) {
    const found = friends.filter(friend => matches(`${friend.displayName} ${friend.id}`, state.query));
    $('list-content').innerHTML = `${!state.query ? `<p class="section-label">내 프로필</p>${personRow(state.data.currentUser, true)}<div class="list-divider"></div>` : ''}<p class="section-label">${state.query ? '검색 결과' : '친구'} <span>${found.length}</span></p>${found.map(friend => personRow(friend)).join('') || `<div class="empty-state"><strong>${state.query ? '검색 결과가 없어요' : '첫 친구를 만나 보세요'}</strong>${state.query ? '이름이나 ID를 다시 확인해 주세요.' : '친구의 ID를 알고 있다면 추가할 수 있어요.'}</div>`}`;
  } else {
    const rooms = state.data.rooms.filter(room => matches(`${roomName(room)} ${room.memberIds.map(id => `${userById(id).displayName} ${id}`).join(' ')}`, state.query));
    $('list-content').innerHTML = `<p class="section-label">${state.query ? '검색 결과' : '모든 대화'} <span>${rooms.length}</span></p>${rooms.map(room => `<button class="room-row ${state.room === room.id ? 'selected' : ''}" data-room="${escape(room.id)}" type="button">${roomAvatar(room)}<span class="room-copy"><span class="room-title">${escape(roomName(room))}${room.type === 'group' ? ` <small>· ${room.memberIds.length}</small>` : ''}</span><span class="room-preview ${room.lastMessage ? '' : 'empty-preview'}">${escape(room.lastMessage?.text || '첫 인사를 건네 보세요')}</span></span><span class="room-meta"><time class="room-time">${time(room.updatedAt)}</time>${room.unreadCount ? `<span class="unread-badge" aria-label="안 읽은 메시지 ${room.unreadCount}개">${room.unreadCount}</span>` : ''}</span></button>`).join('') || '<div class="empty-state"><strong>대화가 없어요</strong>새 채팅으로 첫 대화를 시작해 보세요.</div>'}`;
  }
}
function personRow(user, self = false) {
  return `<button type="button" class="person-row ${state.friend === user.id ? 'selected' : ''}" data-person="${escape(user.id)}">${avatar(user, self ? 'self-avatar' : '')}<span class="person-copy"><span class="person-name">${escape(user.displayName)}${self ? '<span class="self-label">나</span>' : ''}</span><span class="person-description">${escape(user.statusMessage || `@${user.id}`)}</span></span><span class="row-chevron" aria-hidden="true">›</span></button>`;
}
function rememberDraft() {
  if (state.room && $('message-input')) state.drafts.set(keyFor(state.user, state.room), $('message-input').value);
}
function selectMode(mode) {
  state.mode = mode;
  state.query = '';
  $('list-search').value = '';
  $('workspace').classList.remove('mobile-detail');
  renderLists();
}
function selectFriend(id) {
  rememberDraft();
  state.room = null;
  state.friend = id;
  $('workspace').classList.add('mobile-detail');
  renderLists();
  renderProfile();
}
function reconcileFriends() {
  const visible = new Set(state.data.friends.filter(friend => !friend.hidden).map(friend => friend.id));
  for (const id of state.selected) if (!visible.has(id)) state.selected.delete(id);
  if ($('create-dialog').open) renderPicker();
  if (state.friend && state.friend !== state.user && !state.data.friends.some(friend => friend.id === state.friend)) {
    state.friend = null;
    $('detail-panel').innerHTML = '<div class="welcome"><span class="welcome-art" aria-hidden="true">“</span><h2>다음 대화를 만나 보세요.</h2><p>친구 또는 채팅을 선택해 보세요.</p></div>';
    $('workspace').classList.remove('mobile-detail');
  }
}
function renderProfile() {
  const user = userById(state.friend);
  const self = user.id === state.user;
  const friend = state.data.friends.find(item => item.id === user.id);
  $('detail-panel').innerHTML = `<div class="detail-heading"><button type="button" class="icon-button mobile-back" data-action="back" aria-label="목록으로">‹</button><div class="detail-heading-copy"><h2>${self ? '내 프로필' : '친구 프로필'}</h2><p class="detail-subtitle">${self ? '합성 테스트 계정' : '작은 안부가 시작되는 곳'}</p></div>${!self && friend ? `<button class="button subtle" type="button" data-hide="${escape(user.id)}" data-hidden="${!friend.hidden}">${friend.hidden ? '친구 복귀' : '친구 숨김'}</button>` : ''}</div><div class="profile-stage"><p class="profile-brow">A LITTLE CLOSER</p>${avatar(user, 'profile-avatar')}<h2>${escape(user.displayName)}</h2><span class="profile-id">@${escape(user.id)}</span><p class="profile-status">${escape(user.statusMessage)}</p>${!self ? `<button class="button primary" data-direct="${escape(user.id)}" type="button">대화 시작 <span aria-hidden="true">↗</span></button>${friend ? `<button class="button danger-subtle profile-delete" data-block-user="${escape(user.id)}" type="button">친구 차단</button><button class="button danger-subtle profile-delete" data-delete-friend="${escape(user.id)}" type="button">친구 삭제</button>` : ''}` : '<span class="mute-tag">상단에서 다른 테스트 계정으로 전환할 수 있어요</span>'}<div class="profile-divider"></div><p class="profile-footer">오롯이, 우리 대화에 집중해요.</p></div>`;
}
function openRoom(id) {
  rememberDraft();
  state.room = id;
  state.friend = null;
  state.messages = [];
  state.readSequence = 0;
  state.mode = 'chats';
  state.query = '';
  $('list-search').value = '';
  $('workspace').classList.add('mobile-detail');
  const room = roomById(id);
  if (!room) return;
  $('detail-panel').innerHTML = `<div class="chat-view"><div class="detail-heading"><button type="button" class="icon-button mobile-back" data-action="back" aria-label="목록으로">‹</button>${roomAvatar(room)}<div class="detail-heading-copy"><h2>${escape(roomName(room))}</h2><p class="detail-subtitle">${room.type === 'group' ? `${room.memberIds.length}명이 함께하는 대화` : '둘만의 작은 대화'}</p></div><span class="detail-type">${room.type === 'group' ? '그룹' : '1:1'}</span><button class="button subtle" data-action="members" type="button">대화상대</button></div><div class="message-scroll" id="message-scroll" role="log" aria-label="대화 메시지"><div class="loading-state"><span class="spinner"></span>대화를 불러오는 중</div></div><div class="composer-region"><p class="send-restriction" id="send-restriction" role="status" hidden></p><form class="composer" id="message-form"><textarea id="message-input" aria-label="메시지" placeholder="마음을 담아 메시지를 보내세요" maxlength="4000" rows="2"></textarea><div class="composer-bottom"><span class="composer-hint">Enter 전송 · Shift + Enter 줄바꿈</span><button class="button primary send-button" id="send-button" type="submit">보내기 <span aria-hidden="true">↗</span></button></div></form><p class="conversation-note">같은 PC에서 다른 테스트 사용자 창을 열어 대화를 주고받으세요.</p></div></div>`;
  $('message-input').value = state.drafts.get(keyFor(state.user, id)) || '';
  $('message-input').addEventListener('input', () => { rememberDraft(); updateSendButton(); });
  $('message-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage(); }
  });
  $('message-form').addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
  $('message-scroll').addEventListener('scroll', markVisibleRead);
  updateSendButton();
  renderLists();
  refresh();
}
function updateSendButton() {
  if (!$('send-button')) return;
  const sending = state.sending.has(keyFor(state.user, state.room));
  const allowed = canSend();
  $('message-input').readOnly = !allowed;
  $('send-button').disabled = !allowed || sending || !$('message-input').value.trim();
  $('send-button').textContent = sending ? '보내는 중…' : '보내기 ↗';
  const notice = $('send-restriction');
  notice.hidden = allowed;
  notice.textContent = allowed ? '' : '현재 이 1:1 대화에 메시지를 보낼 수 없습니다. 기존 내역은 계속 볼 수 있어요.';
}
function renderMessages() {
  const scroll = $('message-scroll');
  if (!scroll) return;
  const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 70 || !scroll.dataset.loaded;
  const oldTop = scroll.scrollTop;
  let previousDay = '';
  const html = state.messages.map(message => {
    const day = new Date(message.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    const divider = day !== previousDay ? `<div class="day-divider">${escape(day)}</div>` : '';
    previousDay = day;
    const outgoing = message.senderId === state.user;
    const sender = userById(message.senderId);
    return `${divider}<article class="message-row ${outgoing ? 'outgoing' : ''}">${!outgoing ? avatar(sender) : ''}<div class="message-stack">${!outgoing ? `<span class="message-name">${escape(sender.displayName)}</span>` : ''}<div class="message-line"><p class="message-bubble">${escape(message.text)}</p><span class="message-info">${outgoing ? `<span class="read-status">${message.unreadCount ? `안 읽음 ${message.unreadCount}` : '읽음'}</span>` : ''}<time datetime="${escape(message.createdAt)}">${time(message.createdAt)}</time></span></div></div></article>`;
  }).join('') || '<div class="chat-empty"><span class="chat-empty-symbol">“</span><strong>대화의 시작은 작은 안부부터.</strong>첫 메시지를 보내 보세요.</div>';
  // Avoid destroying selection or announcing identical messages on receipt-only refreshes.
  if (scroll.innerHTML !== html) scroll.innerHTML = html;
  scroll.dataset.loaded = 'true';
  scroll.scrollTop = atBottom ? scroll.scrollHeight : oldTop;
}
async function markVisibleRead() {
  const scroll = $('message-scroll');
  const detailHidden = !$('workspace').classList.contains('mobile-detail') && matchMedia('(max-width:700px)').matches;
  if (!state.room || !scroll?.dataset.loaded || document.visibilityState !== 'visible' || !document.hasFocus() || detailHidden || document.querySelector('dialog[open]')) return;
  if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 70) return;
  const sequence = state.messages.at(-1)?.sequence || 0;
  if (sequence <= state.readSequence) return;
  const user = state.user, room = state.room, epoch = state.epoch, key = keyFor(user, room);
  if (state.readPending.has(key)) return;
  state.readPending.add(key);
  let saved = false;
  try {
    const result = await api(`/api/rooms/${encodeURIComponent(room)}/read`, { method: 'POST', body: { sequence }, user });
    if (epoch === state.epoch && room === state.room) state.readSequence = Math.max(state.readSequence, result.sequence);
    saved = true;
  } catch (error) { toast(`읽음 상태를 저장하지 못했습니다. ${error.message}`, true); }
  finally {
    state.readPending.delete(key);
    if (saved && epoch === state.epoch && room === state.room) queueMicrotask(markVisibleRead);
  }
}
async function sendMessage() {
  if (!state.room || !$('message-input') || !canSend()) return;
  const user = state.user, room = state.room, epoch = state.epoch, key = keyFor(user, room);
  const text = $('message-input').value;
  if (!text.trim() || state.sending.has(key)) return;
  const pending = state.pending.get(key);
  const clientId = pending?.text === text ? pending.clientId : crypto.randomUUID();
  state.pending.set(key, { text, clientId });
  state.sending.add(key);
  state.drafts.set(key, text);
  updateSendButton();
  try {
    await api(`/api/rooms/${encodeURIComponent(room)}/messages`, { method: 'POST', body: { text, clientId }, user });
    state.pending.delete(key);
    if (state.drafts.get(key) === text) state.drafts.set(key, '');
    if (epoch === state.epoch && state.room === room && $('message-input')?.value === text) $('message-input').value = '';
    $('sr-status').textContent = '메시지를 보냈습니다.';
    await refresh();
  } catch (error) { toast(`전송 실패. 입력은 유지됩니다. 다시 보내세요. ${error.message}`, true); }
  finally { state.sending.delete(key); updateSendButton(); }
}
function showDialog(id) {
  $(id).showModal();
  $(id).querySelector('input')?.focus();
}
function openDeleteFriend(id) {
  const friend = state.data?.friends.find(item => item.id === id);
  if (!friend || state.deletion) return;
  state.deletion = { id, user: state.user, epoch: state.epoch, pending: false };
  $('delete-friend-name').textContent = `${friend.displayName} (@${friend.id})`;
  $('delete-error').textContent = '';
  setDeletePending(false);
  showDialog('delete-dialog');
  $('delete-cancel').focus();
}
function setDeletePending(pending) {
  for (const button of $('delete-dialog').querySelectorAll('button')) button.disabled = pending;
  $('delete-submit').textContent = pending ? '삭제 중…' : '친구 삭제';
  $('delete-form').setAttribute('aria-busy', String(pending));
}
async function deleteFriend(event) {
  event.preventDefault();
  const request = state.deletion;
  if (!request || request.pending) return;
  request.pending = true;
  setDeletePending(true);
  $('delete-error').textContent = '';
  try {
    await api(`/api/friends/${encodeURIComponent(request.id)}`, { method: 'DELETE', user: request.user });
    if (request.epoch !== state.epoch || state.deletion !== request) return;
    // Reflect the committed deletion even if the follow-up refresh loses its connection.
    state.relationshipRevision++;
    state.data.friends = state.data.friends.filter(friend => friend.id !== request.id);
    reconcileFriends();
    renderLists();
    if ($('manage-dialog').open) renderHidden();
    $('delete-dialog').close();
    state.deletion = null;
    toast('친구를 삭제했습니다. 기존 대화는 남고, 삭제만으로는 수신을 막지 않습니다.');
    if ($('manage-dialog').open) $('manage-dialog').querySelector('.close-dialog').focus();
    else $('list-action').focus();
    await refresh();
  } catch (error) {
    if (request.epoch === state.epoch && state.deletion === request) {
      const message = error instanceof TypeError ? '서버에 연결하지 못했습니다.' : error.message;
      $('delete-error').textContent = `${message} 목록을 확인하거나 다시 시도해 주세요.`;
    }
  } finally {
    if (state.deletion === request) { request.pending = false; setDeletePending(false); $('delete-submit').focus(); }
  }
}
function renderManagedList(id, html) {
  const list = $(id);
  if (list.innerHTML === html) return;
  const focused = list.contains(document.activeElement) ? { ...document.activeElement.dataset } : null;
  list.innerHTML = html;
  if (focused) {
    const replacement = [...list.querySelectorAll('button')].find(button => Object.entries(focused).every(([key, value]) => button.dataset[key] === value));
    (replacement || list.closest('dialog').querySelector('.close-dialog')).focus();
  }
}
function renderHidden() {
  const hidden = state.data.friends.filter(friend => friend.hidden);
  $('hidden-count').textContent = hidden.length;
  renderManagedList('hidden-list', hidden.map(friend => `<div class="manage-row">${avatar(friend)}<span class="person-copy"><span class="person-name">${escape(friend.displayName)}</span><span class="person-description">@${escape(friend.id)}</span></span><div class="manage-actions"><button class="button secondary" type="button" data-hide="${escape(friend.id)}" data-hidden="false">복귀</button><button class="button danger-subtle" type="button" data-block-user="${escape(friend.id)}" aria-label="${escape(friend.displayName)} 차단">차단</button><button class="button danger-subtle" type="button" data-delete-friend="${escape(friend.id)}" aria-label="${escape(friend.displayName)} 친구 삭제">삭제</button></div></div>`).join('') || '<div class="empty-state">숨긴 친구가 없습니다.</div>');
  const blocked = state.data.blockedUsers;
  $('blocked-count').textContent = blocked.length;
  renderManagedList('blocked-list', blocked.map(user => `<div class="manage-row">${avatar(user)}<span class="person-copy"><span class="person-name">${escape(user.displayName)}</span><span class="person-description">@${escape(user.id)}</span></span><button class="button secondary" type="button" data-unblock-user="${escape(user.id)}" aria-label="${escape(user.displayName)} 차단 해제">차단 해제</button></div>`).join('') || '<div class="empty-state">차단한 사용자가 없습니다.</div>');
}
function renderMembers() {
  const room = roomById(state.room);
  if (!room) { $('members-dialog').close(); return; }
  renderManagedList('members-list', room.memberIds.map(id => `<div class="member-row">${avatar(userById(id))}<span class="person-copy"><span class="person-name">${escape(userById(id).displayName)}${id === state.user ? ' (나)' : ''}</span><span class="person-description">@${escape(id)}</span></span>${id !== state.user ? `<button class="button secondary" type="button" data-${isBlocked(id) ? 'unblock' : 'block'}-user="${escape(id)}" aria-label="${escape(userById(id).displayName)} ${isBlocked(id) ? '차단 해제' : '차단'}">${isBlocked(id) ? '차단 해제' : '차단'}</button>` : ''}</div>`).join(''));
}
function openBlockUser(id, blocked) {
  if (state.blocking || id === state.user) return;
  const user = userById(id);
  state.blocking = { id, blocked, user: state.user, epoch: state.epoch, pending: false };
  $('block-title').textContent = blocked ? '사용자 차단' : '차단 해제';
  $('block-user-name').textContent = `${user.displayName} (@${id})`;
  $('block-policy').textContent = blocked
    ? '님을 차단할까요? 내 친구 목록에서 제거하고, 서로 새 1:1 메시지를 보낼 수 없게 됩니다. 기존 대화 내역과 그룹 대화의 송수신은 유지됩니다. 해제해도 친구로 자동 복귀하지 않습니다.'
    : '님의 차단을 해제할까요? 친구로 자동 추가되지 않으며, 원하면 ID로 다시 추가할 수 있습니다. 상대도 나를 차단한 경우 1:1 전송은 계속 제한됩니다.';
  $('block-error').textContent = '';
  setBlockPending(false);
  showDialog('block-dialog');
  $('block-cancel').focus();
}
function setBlockPending(pending) {
  for (const button of $('block-dialog').querySelectorAll('button')) button.disabled = pending;
  $('block-submit').textContent = pending ? '저장 중…' : state.blocking?.blocked ? '차단' : '차단 해제';
  $('block-form').setAttribute('aria-busy', String(pending));
}
async function setUserBlocked(event) {
  event.preventDefault();
  const request = state.blocking;
  if (!request || request.pending) return;
  request.pending = true;
  setBlockPending(true);
  $('block-error').textContent = '';
  try {
    await api(request.blocked ? '/api/blocks' : `/api/blocks/${encodeURIComponent(request.id)}`, {
      method: request.blocked ? 'POST' : 'DELETE',
      body: request.blocked ? { userId: request.id } : undefined, user: request.user,
    });
    if (request.epoch !== state.epoch || state.blocking !== request) return;
    // Apply the acknowledged relationship even if the following GET fails.
    state.relationshipRevision++;
    state.data.blockedUsers = state.data.blockedUsers.filter(user => user.id !== request.id);
    if (request.blocked) {
      state.data.blockedUsers.push({ ...userById(request.id) });
      state.data.friends = state.data.friends.filter(friend => friend.id !== request.id);
      for (const room of state.data.rooms) if (room.type === 'direct' && room.memberIds.includes(request.id)) room.canSend = false;
    }
    reconcileFriends();
    renderLists();
    if ($('manage-dialog').open) renderHidden();
    if ($('members-dialog').open) renderMembers();
    updateSendButton();
    $('block-dialog').close();
    state.blocking = null;
    toast(request.blocked ? '차단했습니다. 기존 내역과 그룹 대화는 유지됩니다.' : '차단을 해제했습니다. 친구는 ID로 다시 추가할 수 있어요.');
    const parent = $('members-dialog').open ? $('members-dialog') : $('manage-dialog').open ? $('manage-dialog') : null;
    (parent?.querySelector('.close-dialog') || $('list-action')).focus();
    await refresh();
  } catch (error) {
    if (request.epoch === state.epoch && state.blocking === request) {
      const message = error instanceof TypeError ? '서버에 연결하지 못했습니다.' : error.message;
      $('block-error').textContent = `${message} 상태를 확인하거나 다시 시도해 주세요.`;
    }
  } finally {
    if (state.blocking === request) { request.pending = false; setBlockPending(false); $('block-submit').focus(); }
  }
}
function renderPicker() {
  const query = $('create-search').value;
  const friends = state.data.friends.filter(friend => !friend.hidden && matches(`${friend.displayName} ${friend.id}`, query));
  const list = $('create-friends');
  const focusedId = list.contains(document.activeElement) ? document.activeElement.value : null;
  const html = friends.map(friend => `<label class="picker-row">${avatar(friend)}<span class="person-copy"><span class="person-name">${escape(friend.displayName)}</span><span class="person-description">@${escape(friend.id)}</span></span><input type="checkbox" value="${escape(friend.id)}" ${state.selected.has(friend.id) ? 'checked' : ''} aria-label="${escape(friend.displayName)} 선택"></label>`).join('') || '<div class="empty-state">선택할 친구가 없습니다.</div>';
  if (list.innerHTML !== html) {
    list.innerHTML = html;
    if (focusedId) ([...list.querySelectorAll('input')].find(input => input.value === focusedId) || $('create-search')).focus();
  }
  $('group-title-field').hidden = state.selected.size < 2;
  $('selection-count').textContent = `${state.selected.size}명 선택`;
  $('create-submit').disabled = Boolean(state.creating) || state.selected.size === 0;
}
function openCreate() {
  state.selected.clear();
  $('create-form').reset();
  $('create-error').textContent = '';
  renderPicker();
  showDialog('create-dialog');
}
async function createRoom(memberIds, title = '') {
  const epoch = state.epoch;
  const room = await api('/api/rooms', { method: 'POST', body: { memberIds, title } });
  if (epoch !== state.epoch) return;
  await refresh();
  if (epoch === state.epoch) openRoom(room.id);
}

$('nav-friends').addEventListener('click', () => selectMode('friends'));
$('nav-chats').addEventListener('click', () => selectMode('chats'));
$('list-search').addEventListener('input', event => { state.query = event.target.value; renderLists(); });
$('account-select').addEventListener('change', async event => {
  rememberDraft();
  state.user = event.target.value;
  state.epoch++;
  state.data = null; state.room = null; state.friend = null; state.messages = []; state.query = '';
  state.deletion = null; state.creating = null; state.blocking = null;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('list-search').value = '';
  $('detail-panel').innerHTML = '<div class="welcome"><span class="welcome-art" aria-hidden="true">“</span><h2>새로운 시선으로,<br>다시 만나는 대화.</h2><p>친구 또는 채팅을 선택해 보세요.</p></div>';
  $('workspace').classList.remove('mobile-detail');
  history.replaceState({}, '', `/?user=${encodeURIComponent(state.user)}`);
  connect();
  await refresh();
});
$('list-action').addEventListener('click', () => {
  if (!state.data) return;
  if (state.mode === 'chats') return openCreate();
  $('add-form').reset(); $('add-error').textContent = '';
  $('test-ids').textContent = `테스트 ID: ${state.data.users.filter(user => user.id !== state.user).map(user => user.id).join(', ')}`;
  showDialog('add-dialog');
});
$('manage-friends').addEventListener('click', () => { if (state.data) { renderHidden(); showDialog('manage-dialog'); } });
$('create-search').addEventListener('input', renderPicker);
$('create-friends').addEventListener('change', event => {
  if (!event.target.matches('input[type=checkbox]')) return;
  if (event.target.checked) state.selected.add(event.target.value); else state.selected.delete(event.target.value);
  $('group-title-field').hidden = state.selected.size < 2;
  $('selection-count').textContent = `${state.selected.size}명 선택`;
  $('create-submit').disabled = Boolean(state.creating) || !state.selected.size;
});
$('add-form').addEventListener('submit', async event => {
  event.preventDefault();
  const epoch = state.epoch;
  $('add-submit').disabled = true; $('add-error').textContent = '';
  try {
    const friend = await api('/api/friends', { method: 'POST', body: { userId: $('friend-id').value.trim() } });
    if (epoch !== state.epoch) return;
    $('add-dialog').close();
    await refresh();
    if (epoch === state.epoch) { selectMode('friends'); selectFriend(friend.id); toast('친구를 추가했습니다.'); }
  } catch (error) { if (epoch === state.epoch) $('add-error').textContent = error.message; }
  finally { $('add-submit').disabled = false; }
});
$('create-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.selected.size || state.creating) return;
  const request = { epoch: state.epoch };
  state.creating = request;
  $('create-submit').disabled = true; $('create-error').textContent = '';
  try {
    await createRoom([...state.selected], $('group-title').value.trim());
    if (request.epoch === state.epoch && state.creating === request) $('create-dialog').close();
  } catch (error) {
    if (request.epoch === state.epoch && state.creating === request) $('create-error').textContent = error.message;
  } finally {
    if (state.creating === request) { state.creating = null; $('create-submit').disabled = !state.selected.size; }
  }
});
$('delete-form').addEventListener('submit', deleteFriend);
$('delete-dialog').addEventListener('cancel', event => { if (state.deletion?.pending) event.preventDefault(); });
$('delete-dialog').addEventListener('close', () => { state.deletion = null; });
$('block-form').addEventListener('submit', setUserBlocked);
$('block-dialog').addEventListener('cancel', event => { if (state.blocking?.pending) event.preventDefault(); });
$('block-dialog').addEventListener('close', () => { state.blocking = null; });
document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.classList.contains('close-dialog')) return target.closest('dialog').close();
  if (target.dataset.blockUser) return openBlockUser(target.dataset.blockUser, true);
  if (target.dataset.unblockUser) return openBlockUser(target.dataset.unblockUser, false);
  if (target.dataset.deleteFriend) return openDeleteFriend(target.dataset.deleteFriend);
  if (target.dataset.person) return selectFriend(target.dataset.person);
  if (target.dataset.room) return openRoom(target.dataset.room);
  if (target.dataset.action === 'retry') return refresh();
  if (target.dataset.action === 'back') return $('workspace').classList.remove('mobile-detail');
  if (target.dataset.action === 'members') {
    renderMembers();
    return showDialog('members-dialog');
  }
  if (target.dataset.direct) {
    target.disabled = true;
    try { await createRoom([target.dataset.direct]); } catch (error) { toast(error.message, true); target.disabled = false; }
  }
  if (target.dataset.hide) {
    const epoch = state.epoch, hidden = target.dataset.hidden === 'true';
    target.disabled = true;
    try {
      await api(`/api/friends/${encodeURIComponent(target.dataset.hide)}`, { method: 'PATCH', body: { hidden } });
      await refresh();
      if (epoch === state.epoch) toast(hidden ? '친구 목록에서 숨겼습니다. 숨김만으로는 메시지 수신을 막지 않습니다.' : '친구 목록에 다시 표시했습니다.');
    } catch (error) { toast(error.message, true); target.disabled = false; }
  }
});
window.addEventListener('focus', () => { markVisibleRead(); refresh(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { markVisibleRead(); refresh(); } });
window.addEventListener('beforeunload', () => state.source?.close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', markVisibleRead);
$('account-select').value = state.user;
connect();
refresh();
