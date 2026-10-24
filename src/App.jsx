import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowUp, Bell, BellOff, Check, ChevronDown, ChevronRight, CircleHelp, Hash, LogOut, MessageCircle, MessageCirclePlus, MoreHorizontal, Pencil, Pin, Search, Settings, ShieldBan, Smile, Star, UserRound, UserRoundPlus, UsersRound, X } from 'lucide-react';

const SESSION_KEY = 'mytalk.session.v1';
const COLORS = ['#b8c8e0', '#d6b6b1', '#b8cbb7', '#c6bbdb', '#e4c594', '#a9cccf'];
const EMOJI = ['😊', '😄', '🥰', '😂', '🥹', '😎', '👍', '👏', '❤️', '💛', '🎉', '☕', '🍀', '✨', '🙌', '💬'];
const label = (person) => person?.alias || person?.name || '알 수 없음';
const dateLabel = (value) => new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const clock = (value) => new Date(value).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
const shortTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString() ? clock(value) : date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
};

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || '요청을 처리하지 못했습니다.'), { status: response.status });
  return data;
}

function Avatar({ person, size = '', group, self = false }) {
  return <span className={`avatar ${size} ${group ? 'group-avatar' : ''}`} style={{ '--avatar-color': person?.avatarColor || '#bccbdd' }}>
    {group ? <UsersRound size={size === 'large' ? 32 : 23} /> : (person?.name || '?').slice(0, 1)}
    {self && <span className="me-tag">나</span>}
  </span>;
}

function IconButton({ icon: Icon, label: name, active, className = '', ...props }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${className}`} title={name} aria-label={name} {...props}><Icon size={21} strokeWidth={1.65} /></button>;
}

function Modal({ title, children, onClose, className = '' }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.querySelector('input, textarea, button')?.focus();
    const key = (event) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const controls = [...panelRef.current.querySelectorAll('button:not(:disabled), input, textarea, select, [tabindex="0"]')];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
      <div className="modal-heading"><h2>{title}</h2><IconButton icon={X} label="닫기" onClick={onClose} /></div>
      {children}
    </section>
  </div>;
}

function Login({ onLogin }) {
  const [register, setRegister] = useState(false);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event, demo = false) {
    event?.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await request(`/auth/${register && !demo ? 'register' : 'login'}`, null, 'POST', demo ? { handle: 'young', password: '12345678' } : { handle, name, password });
      onLogin(result.token);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="login-page">
    <div className="login-story">
      <div className="brand"><span className="brand-symbol"><MessageCircle fill="currentColor" size={26} /></span><b>나의 톡</b><span>DESKTOP</span></div>
      <div className="login-copy"><span className="eyebrow">가까운 사람들과, 더 가까이</span><h1>별일 없는 하루도<br />나누면 이야기가 돼요.</h1><p>친구를 찾고, 안부를 묻고.<br />우리의 일상을 이어주는 작은 대화.</p></div>
      <div className="illustration" aria-hidden="true"><div className="ill-bubble white">오늘 어땠어? <span>☀️</span></div><div className="ill-bubble yellow">네 생각이 났어! <span>💛</span></div><div className="ill-dot one" /><div className="ill-dot two" /><div className="ill-note">일상과 일상 사이, 나의 톡</div></div>
      <div className="login-foot">친구와 채팅에 집중한 개인 메신저 <span>01 / FRIENDS & CHAT</span></div>
    </div>
    <section className="login-form-wrap">
      <div className="login-form">
        <span className="login-mark"><MessageCircle size={37} fill="currentColor" /></span>
        <h2>{register ? '우리의 첫 대화, 시작해요' : '반가워요, 다시 만나서'}</h2><p>{register ? '나만의 톡 계정을 만들어 주세요.' : '나의 톡에 로그인해 대화를 이어가세요.'}</p>
        <form onSubmit={submit}>
          {register && <label>이름<input aria-label="이름" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="친구에게 보여질 이름" required /></label>}
          <label>아이디<input aria-label="아이디" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" placeholder="영문, 숫자로 된 아이디" required minLength={3} maxLength={30} /></label>
          <label>비밀번호<input aria-label="비밀번호" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register ? 'new-password' : 'current-password'} placeholder="8자 이상 입력해 주세요" required minLength={8} maxLength={128} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary full" disabled={busy}>{busy ? '연결하는 중…' : register ? '계정 만들기' : '로그인'}</button>
        </form>
        <button className="text-button auth-toggle" onClick={() => { setRegister(!register); setError(''); }}>{register ? '이미 계정이 있어요 · 로그인' : '처음 오셨나요? 계정 만들기'}</button>
        <div className="demo-divider"><span />먼저 살펴보고 싶다면<span /></div>
        <button className="secondary full" onClick={(event) => submit(event, true)} disabled={busy}>데모 계정으로 둘러보기 <ChevronRight size={16} /></button>
        <p className="login-disclaimer">이 PC에 저장되는 독립 메신저입니다.<br />카카오톡 계정과 연결되지 않습니다.</p>
      </div>
    </section>
  </main>;
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(SESSION_KEY));
  const [me, setMe] = useState(null);
  const [friends, setFriends] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [tab, setTab] = useState('friends');
  const [filter, setFilter] = useState('');
  const [roomId, setRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [connected, setConnected] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [typing, setTyping] = useState({});
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState('');
  const socketRef = useRef(null);
  const activeRef = useRef(null);
  const refreshRef = useRef(null);
  const loadMessagesRef = useRef(null);
  const bottomRef = useRef(null);
  const composerRef = useRef(null);
  const stickyRef = useRef(true);
  const typingTimeoutRef = useRef(null);
  const searchRef = useRef('');
  const toastTimer = useRef(null);
  const sessionRef = useRef(token);
  const roomsRef = useRef(rooms);
  const meRef = useRef(me);
  const historyRef = useRef({ id: null, query: '', paged: false });
  const pendingSendsRef = useRef({});
  const lastTypingRef = useRef({ roomId: null, time: 0 });
  sessionRef.current = token;
  roomsRef.current = rooms;
  meRef.current = me;
  activeRef.current = roomId;
  searchRef.current = chatSearch;
  const api = useCallback((path, method, body) => request(path, token, method, body), [token]);
  const notify = useCallback((message) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); }, []);

  const login = (session) => { sessionStorage.setItem(SESSION_KEY, session); sessionRef.current = session; setLoading(true); setLoadError(''); setToken(session); };
  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY); sessionRef.current = null; pendingSendsRef.current = {}; setToken(null); setMe(null); setFriends([]); setRooms([]); setRoomId(null); setModal(null); setMessages([]); setDrafts({}); setTyping({}); setLoadError(''); setConnected(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [user, friendList, roomList] = await Promise.all([api('/me'), api('/friends'), api('/rooms')]);
      if (sessionRef.current !== token) return;
      setMe(user); setFriends(friendList); setRooms(roomList); setLoadError('');
      if (activeRef.current && !roomList.some((item) => item.id === activeRef.current)) { setRoomId(null); setMessages([]); }
    } catch (error) {
      if (sessionRef.current !== token) return;
      if (error.status === 401) logout(); else setLoadError(error.message);
    } finally { if (sessionRef.current === token) setLoading(false); }
  }, [token, api, logout]);
  refreshRef.current = refresh;

  const loadMessages = useCallback(async (id, query = '', older = false) => {
    if (!id) return;
    if (historyRef.current.id !== id || historyRef.current.query !== query) historyRef.current = { id, query, paged: false };
    setMessagesLoading(true);
    try {
      const before = older && messages.length ? `&before=${messages[0].id}` : '';
      const result = await api(`/rooms/${id}/messages?q=${encodeURIComponent(query)}${before}`);
      if (sessionRef.current !== token || activeRef.current !== id || searchRef.current !== query) return;
      setMessages((previous) => {
        if (query && !older) return result.messages;
        const merged = new Map((older ? [...result.messages, ...previous] : [...previous, ...result.messages]).map((item) => [item.id, item]));
        return [...merged.values()].sort((a, b) => a.id - b.id);
      });
      if (older) historyRef.current.paged = true;
      if (older || !historyRef.current.paged) setHasMore(result.hasMore);
    } catch (error) { notify(error.message); } finally { setMessagesLoading(false); }
  }, [api, messages, notify, token]);
  loadMessagesRef.current = loadMessages;

  useEffect(() => { if (token) refresh(); }, [token, refresh]);
  useEffect(() => {
    if (!token) return;
    let refreshTimer;
    const socket = io({ auth: { token }, reconnection: true });
    socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); refreshRef.current?.(); if (activeRef.current) loadMessagesRef.current?.(activeRef.current, searchRef.current); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('data:changed', () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshRef.current?.(); if (activeRef.current) loadMessagesRef.current?.(activeRef.current, searchRef.current); }, 80);
    });
    socket.on('message:new', (message) => {
      if (activeRef.current === message.roomId && document.visibilityState === 'visible') {
        api(`/rooms/${message.roomId}/read`, 'POST').catch(() => {});
      }
      const destination = roomsRef.current.find((item) => item.id === message.roomId);
      if (message.senderId !== meRef.current?.id && activeRef.current !== message.roomId && !destination?.muted) {
        notify(`새 메시지: ${String(message.text).slice(0, 55)}`);
      }
    });
    socket.on('typing', (event) => setTyping((previous) => ({ ...previous, [`${event.roomId}:${event.userId}`]: { ...event, time: Date.now() } })));
    const interval = setInterval(() => setTyping((previous) => Object.fromEntries(Object.entries(previous).filter(([, value]) => value.isTyping && Date.now() - value.time < 4000))), 2000);
    const visible = () => { if (activeRef.current && document.visibilityState === 'visible') api(`/rooms/${activeRef.current}/read`, 'POST').then(() => refreshRef.current?.()).catch(() => {}); };
    document.addEventListener('visibilitychange', visible);
    return () => { socket.disconnect(); socketRef.current = null; clearTimeout(refreshTimer); clearInterval(interval); clearTimeout(typingTimeoutRef.current); document.removeEventListener('visibilitychange', visible); };
  }, [token, api, notify]);

  useEffect(() => {
    setMessages([]); setHasMore(false); setChatSearch(''); setChatSearchOpen(false); setInfoOpen(false); setEmojiOpen(false); stickyRef.current = true;
    historyRef.current = { id: roomId, query: '', paged: false };
    if (!roomId) return;
    loadMessagesRef.current?.(roomId, '');
    api(`/rooms/${roomId}/read`, 'POST').then(() => refreshRef.current?.()).catch((error) => notify(error.message));
    composerRef.current?.focus();
  }, [roomId, api, notify]);
  useEffect(() => {
    if (!roomId) return;
    const timer = setTimeout(() => { if (chatSearch) setMessages([]); loadMessagesRef.current?.(roomId, chatSearch); }, 200);
    return () => clearTimeout(timer);
  }, [chatSearch, roomId]);
  useEffect(() => { if (stickyRef.current && !chatSearch) bottomRef.current?.scrollIntoView({ behavior: 'instant' }); }, [messages, roomId, chatSearch]);

  const mutate = async (path, method, body, success) => {
    try { const result = await api(path, method, body); if (sessionRef.current !== token) throw new Error('계정이 변경되었습니다.'); await refresh(); if (success) notify(success); return result; } catch (error) { if (sessionRef.current === token) notify(error.message); throw error; }
  };
  const friendAction = (id, change, message) => mutate(`/friends/${id}`, 'PATCH', change, message);
  const room = rooms.find((item) => item.id === roomId);
  const friendById = (id) => friends.find((item) => item.id === id);
  const member = (id) => id === me?.id ? me : friendById(id) || room?.members.find((item) => item.id === id);
  const roomPerson = (item) => item?.members.find((person) => person.id !== me?.id) || me;
  const roomName = (item) => item?.type === 'self' ? `${me?.name} (나와의 채팅)` : item?.type === 'direct' ? label(friendById(roomPerson(item)?.id) || roomPerson(item)) : item?.name || item?.members.filter((person) => person.id !== me?.id).map((person) => label(friendById(person.id) || person)).join(', ');
  const activeFriends = friends.filter((item) => !item.hidden && !item.blocked);
  const favorites = activeFriends.filter((item) => item.favorite);
  const shownFriends = activeFriends.filter((item) => `${label(item)} ${item.name} ${item.handle}`.toLowerCase().includes(filter.toLowerCase()));
  const shownRooms = rooms.filter((item) => `${roomName(item)} ${item.lastMessage?.text || ''}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.lastMessage?.createdAt || b.updatedAt || '').localeCompare(String(a.lastMessage?.createdAt || a.updatedAt || '')));
  const totalUnread = rooms.reduce((count, item) => count + item.unreadCount, 0);
  const draft = drafts[roomId] || '';
  const typingNames = Object.values(typing).filter((item) => item.roomId === roomId && item.userId !== me?.id && item.isTyping).map((item) => label(member(item.userId)));
  useEffect(() => { document.title = totalUnread ? `(${totalUnread}) 나의 톡` : '나의 톡 — 친구와 나누는 일상'; }, [totalUnread]);

  async function openChat(ids = [], name) {
    try {
      const result = await mutate('/rooms', 'POST', { memberIds: ids, ...(name ? { name } : {}) });
      setRoomId(result.id); setTab('chats'); setFilter(''); setModal(null);
    } catch { /* shown in toast */ }
  }
  function changeDraft(value) {
    setDrafts((previous) => ({ ...previous, [roomId]: value }));
    const now = Date.now();
    if (!value || lastTypingRef.current.roomId !== roomId || now - lastTypingRef.current.time > 900) {
      socketRef.current?.emit('typing', { roomId, isTyping: Boolean(value) });
      lastTypingRef.current = { roomId, time: now };
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socketRef.current?.emit('typing', { roomId, isTyping: false }), 1800);
  }
  async function send(event) {
    event?.preventDefault();
    const text = draft.trim(); const sendingRoom = roomId;
    if (!text || sending || chatSearch) return;
    if (pendingSendsRef.current[sendingRoom]?.text !== text) pendingSendsRef.current[sendingRoom] = { text, clientId: crypto.randomUUID() };
    const clientId = pendingSendsRef.current[sendingRoom].clientId;
    setSending(true); stickyRef.current = true;
    try {
      const message = await api(`/rooms/${sendingRoom}/messages`, 'POST', { text, clientId });
      if (sessionRef.current !== token) return;
      delete pendingSendsRef.current[sendingRoom];
      setDrafts((previous) => ({ ...previous, [sendingRoom]: previous[sendingRoom] === draft ? '' : previous[sendingRoom] }));
      if (activeRef.current === sendingRoom) setMessages((previous) => [...new Map([...previous, message].map((item) => [item.id, item])).values()].sort((a, b) => a.id - b.id));
      socketRef.current?.emit('typing', { roomId: sendingRoom, isTyping: false }); setEmojiOpen(false); await refresh();
    } catch (error) { notify(error.message); } finally { setSending(false); composerRef.current?.focus(); }
  }

  if (!token) return <Login onLogin={login} />;
  if (loading || !me) return <div className="loading-screen"><span className="loading-logo"><MessageCircle size={36} fill="currentColor" /></span><h2>대화를 불러오고 있어요</h2>{loadError ? <><p role="alert">{loadError}</p><button className="primary" onClick={() => { setLoading(true); refresh(); }}>다시 연결</button><button className="text-button" onClick={logout}>로그인으로 돌아가기</button></> : <p>잠시만 기다려 주세요.</p>}</div>;

  const friendRow = (person, favoriteSection = false) => <button className="friend-row" key={person.id} onClick={() => setModal({ kind: 'profile', id: person.id })} onDoubleClick={() => openChat([person.id])}>
    <Avatar person={person} /><span className="person-content"><b>{label(person)}</b><span>{person.status || `@${person.handle}`}</span></span>{favoriteSection && <Star size={12} fill="#b7a574" stroke="#b7a574" />}
  </button>;

  return <div className="app-shell">
    <aside className="rail" aria-label="메인 메뉴">
      <button className="rail-brand" aria-label="나의 톡 홈" onClick={() => { setTab('friends'); setFilter(''); }}><MessageCircle size={25} fill="currentColor" strokeWidth={1.4} /></button>
      <div className="rail-main">
        <IconButton icon={UserRound} label="친구" active={tab === 'friends'} onClick={() => { setTab('friends'); setFilter(''); setRoomId(null); }} />
        <div className="nav-chat"><IconButton icon={MessageCircle} label="채팅" active={tab === 'chats'} onClick={() => { setTab('chats'); setFilter(''); if (window.innerWidth <= 760) setRoomId(null); }} />{totalUnread > 0 && <span className="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}</div>
      </div>
      <div className="rail-bottom"><span className={`connection-dot ${connected ? 'online' : ''}`} title={connected ? '실시간 연결됨' : '서버에 다시 연결 중'} /><IconButton icon={Settings} label="설정" onClick={() => setModal({ kind: 'settings' })} /><button className="rail-profile" aria-label="내 프로필 편집" onClick={() => setModal({ kind: 'me' })}><Avatar person={me} size="tiny" /></button></div>
    </aside>

    <section className="list-pane" aria-label={tab === 'friends' ? '친구 목록' : '채팅 목록'}>
      <div className="list-topline"><span>나의 톡</span><span className="desktop-tag">PC</span></div>
      <header className="list-header"><h1>{tab === 'friends' ? '친구' : '채팅'} <span>{tab === 'friends' ? activeFriends.length : rooms.length}</span></h1><div className="header-actions">{tab === 'friends' ? <><IconButton icon={UserRoundPlus} label="친구 추가" onClick={() => setModal({ kind: 'add' })} /><IconButton icon={Settings} label="친구 관리" onClick={() => setModal({ kind: 'manage' })} /></> : <IconButton icon={MessageCirclePlus} label="새로운 채팅" onClick={() => setModal({ kind: 'newChat' })} />}</div></header>
      <div className="list-search"><Search size={17} /><input aria-label={tab === 'friends' ? '친구 검색' : '채팅방 검색'} placeholder={tab === 'friends' ? '이름 또는 아이디 검색' : '채팅방 이름, 대화 내용 검색'} value={filter} onChange={(event) => setFilter(event.target.value)} />{filter && <button aria-label="검색어 지우기" onClick={() => setFilter('')}><X size={14} /></button>}</div>
      <div className="list-scroll">
        {tab === 'friends' ? <>
          {!filter && <><button className="friend-row my-profile" onClick={() => setModal({ kind: 'me' })}><Avatar person={me} self /><span className="person-content"><b>{me.name}</b><span>{me.status || '친구에게 나를 소개해 보세요'}</span></span><Pencil size={14} className="muted" /></button><div className="list-section-title"><span>즐겨찾기 <b>{favorites.length}</b></span><Star size={12} /></div>{favorites.length ? favorites.map((person) => friendRow(person, true)) : <p className="section-note">자주 만나는 친구를 즐겨찾기에 추가해 보세요.</p>}</>}
          <div className="list-section-title"><span>{filter ? '검색 결과' : '친구'} <b>{shownFriends.length}</b></span><ChevronDown size={13} /></div>
          {shownFriends.length ? shownFriends.map((person) => friendRow(person)) : <div className="list-empty"><UsersRound size={31} /><p>{filter ? '검색 결과가 없어요' : '친구와 첫 인사를 나눠 보세요'}</p>{!filter && <button className="text-button" onClick={() => setModal({ kind: 'add' })}>아이디로 친구 추가</button>}</div>}
        </> : <>{shownRooms.map((item) => <button key={item.id} className={`room-row ${item.id === roomId ? 'selected' : ''}`} onClick={() => setRoomId(item.id)}>
          <Avatar person={roomPerson(item)} group={item.type === 'group'} self={item.type === 'self'} /><span className="room-content"><span className="room-title"><b>{roomName(item)}</b>{item.type === 'group' && <span>{item.members.length}</span>}{item.pinned && <Pin size={11} fill="currentColor" />}{item.muted && <BellOff size={12} />}</span><span className="last-message">{item.lastMessage?.text || '새로운 대화를 시작해 보세요'}</span></span><span className="room-meta"><time>{shortTime(item.lastMessage?.createdAt || item.updatedAt)}</time>{item.unreadCount > 0 && <span className="unread-badge">{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>}</span>
        </button>)}{!shownRooms.length && <div className="list-empty"><MessageCircle size={31} /><p>{filter ? '검색 결과가 없어요' : '아직 시작한 대화가 없어요'}</p><button className="text-button" onClick={() => setModal({ kind: 'newChat' })}>대화 시작하기</button></div>}</>}
      </div>
      <footer className="list-footer"><span className="small-yellow-dot" /><span>일상을 나누는 가장 가까운 공간</span></footer>
    </section>

    <main className={`conversation ${room ? '' : 'is-empty'}`}>
      {loadError && <div className="connection-banner" role="alert">{loadError}<button onClick={refresh}>다시 시도</button></div>}
      {!connected && !loadError && <div className="connection-banner">서버에 다시 연결하고 있어요. 작성 중인 메시지는 유지됩니다.</div>}
      {room ? <>
        <header className="chat-header"><button className="chat-person" onClick={() => room.type === 'direct' ? setModal({ kind: 'profile', id: roomPerson(room).id }) : setInfoOpen(!infoOpen)}><Avatar person={roomPerson(room)} group={room.type === 'group'} size="small" /><span><b>{roomName(room)}</b><span>{room.type === 'self' ? '나를 위한 작은 메모 공간' : room.type === 'group' ? `함께 대화하는 ${room.members.length}명` : friendById(roomPerson(room).id)?.status || '친구와 나누는 일상'}</span></span></button><div className="header-actions"><IconButton icon={Search} label="대화 검색" active={chatSearchOpen} onClick={() => { setChatSearchOpen(!chatSearchOpen); setChatSearch(''); }} /><IconButton icon={MoreHorizontal} label="채팅방 정보" active={infoOpen} onClick={() => setInfoOpen(!infoOpen)} /></div></header>
        {chatSearchOpen && <div className="chat-search"><Search size={17} /><input autoFocus aria-label="대화 내용 검색" placeholder="이 채팅방에서 메시지 검색" value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} /><span>{chatSearch ? `${messages.length}개` : ''}</span><IconButton icon={X} label="대화 검색 닫기" onClick={() => { setChatSearch(''); setChatSearchOpen(false); }} /></div>}
        <div className="chat-body-wrap"><div className="message-scroll" onScroll={(event) => { const target = event.currentTarget; stickyRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100; }}>
          {hasMore && <button className="older-button" disabled={messagesLoading} onClick={() => { stickyRef.current = false; loadMessages(roomId, chatSearch, true); }}>{messagesLoading ? '불러오는 중…' : '이전 대화 불러오기'}</button>}
          {!messages.length && <div className="message-empty"><MessageCircle size={30} /><p>{messagesLoading ? '대화를 불러오고 있어요' : chatSearch ? '일치하는 메시지가 없어요' : '따뜻한 첫마디를 건네 보세요.'}</p></div>}
          {messages.map((message, index) => {
            const own = message.senderId === me.id;
            const previous = messages[index - 1];
            const differentDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
            const grouped = !differentDay && previous.senderId === message.senderId && clock(previous.createdAt) === clock(message.createdAt);
            const sender = member(message.senderId);
            return <React.Fragment key={message.id}>{differentDay && <div className="day-divider"><span>{dateLabel(message.createdAt)}</span></div>}<div className={`message-row ${own ? 'own' : ''} ${grouped ? 'grouped' : ''}`}>
              {!own && <span className="message-avatar">{!grouped && <Avatar person={sender} size="small" />}</span>}
              <div className="message-content">{!own && !grouped && <span className="sender-name">{label(sender)}</span>}<div className="bubble-line"><div className="message-bubble">{message.text}</div><div className="bubble-meta">{own && message.unreadCount > 0 && <span className="read-count" title="아직 읽지 않은 참여자 수">{message.unreadCount}</span>}<time>{clock(message.createdAt)}</time></div></div></div>
            </div></React.Fragment>;
          })}<div ref={bottomRef} />
        </div>
        {infoOpen && <aside className="room-info"><div className="room-info-heading"><h3>채팅방 정보</h3><IconButton icon={X} label="정보 닫기" onClick={() => setInfoOpen(false)} /></div><Avatar person={roomPerson(room)} group={room.type === 'group'} size="large" /><h3 className="room-info-title">{roomName(room)}</h3><span className="room-info-type">{room.type === 'group' ? '그룹채팅' : room.type === 'self' ? '나와의 채팅' : '1:1 채팅'}</span><div className="room-quick-actions"><button onClick={() => mutate(`/rooms/${roomId}`, 'PATCH', { pinned: !room.pinned }, room.pinned ? '고정을 해제했어요' : '채팅방을 상단에 고정했어요').catch(() => {})}><Pin size={18} fill={room.pinned ? 'currentColor' : 'none'} />{room.pinned ? '고정 해제' : '상단 고정'}</button><button onClick={() => mutate(`/rooms/${roomId}`, 'PATCH', { muted: !room.muted }, room.muted ? '알림을 켰어요' : '알림을 껐어요').catch(() => {})}>{room.muted ? <BellOff size={18} /> : <Bell size={18} />}{room.muted ? '알림 켜기' : '알림 끄기'}</button></div><div className="list-section-title"><span>대화 상대 <b>{room.members.length}</b></span></div>{room.members.map((person) => <button className="member-row" key={person.id} onClick={() => setModal({ kind: person.id === me.id ? 'me' : 'profile', id: person.id })}><Avatar person={person} size="tiny" /><span>{label(friendById(person.id) || person)}</span>{person.id === me.id && <small>나</small>}</button>)}{room.type === 'group' && <button className="secondary full rename-room" onClick={() => setModal({ kind: 'renameRoom' })}><Pencil size={14} />채팅방 이름 변경</button>}<button className="leave-button" onClick={() => setModal({ kind: 'leave' })}><LogOut size={16} />채팅방 나가기</button></aside>}
        </div>
        <div className="typing-indicator" aria-live="polite">{typingNames.length > 0 && <><span className="typing-dots">•••</span> {typingNames.join(', ')} 님이 입력 중이에요</>}</div>
        <form className="composer" onSubmit={send}><textarea ref={composerRef} aria-label="메시지 입력" placeholder="메시지를 입력하세요" value={draft} maxLength={5000} onChange={(event) => changeDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }} /><div className="composer-tools"><div className="emoji-anchor"><IconButton icon={Smile} label="이모지" active={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)} type="button" />{emojiOpen && <div className="emoji-picker" aria-label="이모지 선택">{EMOJI.map((emoji) => <button type="button" aria-label={`이모지 ${emoji}`} key={emoji} onClick={() => { changeDraft(draft + emoji); composerRef.current?.focus(); }}>{emoji}</button>)}</div>}</div><span className="composer-hint">Enter 전송 · Shift + Enter 줄바꿈</span><span className="character-count">{draft.length > 4500 && `${draft.length}/5000`}</span><button className="send-button" aria-label="메시지 전송" disabled={!draft.trim() || sending || Boolean(chatSearch)}><span>{sending ? '전송 중' : '전송'}</span><ArrowUp size={15} /></button></div>{chatSearch && <div className="search-composer-note">검색을 닫으면 메시지를 보낼 수 있어요.</div>}</form>
      </> : <div className="welcome"><span className="welcome-orbit"><MessageCircle size={57} strokeWidth={1.2} /><span className="orbit-dot" /></span><span className="eyebrow">YOUR EVERYDAY, CONNECTED</span><h2>마음을 잇는 작은 대화</h2><p>친구를 선택하고 이야기를 시작해 보세요.<br />소소한 안부가 특별한 하루를 만들 거예요.</p><button className="primary" onClick={() => setModal({ kind: 'newChat' })}><MessageCirclePlus size={17} />새로운 대화 시작</button><div className="welcome-caption"><span /><span>친구와 나, 우리만의 공간</span><span /></div></div>}
    </main>

    {modal?.kind === 'add' && <AddFriend api={api} onClose={() => setModal(null)} onAdd={async (handle) => { await mutate('/friends', 'POST', { handle }, '친구를 추가했어요'); setModal(null); }} />}
    {modal?.kind === 'newChat' && <NewChat friends={activeFriends} onClose={() => setModal(null)} onCreate={openChat} />}
    {modal?.kind === 'me' && <EditProfile me={me} onClose={() => setModal(null)} onSave={async (change) => { await mutate('/me', 'PATCH', change, '프로필을 저장했어요'); setModal(null); }} onSelfChat={() => openChat()} />}
    {modal?.kind === 'profile' && <Profile person={friendById(modal.id) || room?.members.find((person) => person.id === modal.id)} onClose={() => setModal(null)} onChat={() => openChat([modal.id])} onChange={(change, message) => friendAction(modal.id, change, message)} onAdd={async (handle) => { await mutate('/friends', 'POST', { handle }, '친구를 추가했어요'); }} isFriend={Boolean(friendById(modal.id))} />}
    {modal?.kind === 'manage' && <ManageFriends friends={friends} onClose={() => setModal(null)} onChange={friendAction} />}
    {modal?.kind === 'settings' && <Modal title="설정" onClose={() => setModal(null)}><div className="settings-content"><div className="settings-brand"><MessageCircle size={25} fill="currentColor" /><b>나의 톡</b><span>v0.1.0</span></div><div className="setting-detail"><span>내 계정</span><b>@{me.handle}</b></div><div className="setting-detail"><span>연결 상태</span><b className={connected ? 'success-color' : ''}>{connected ? '실시간 연결됨' : '다시 연결 중'}</b></div><p className="setting-note">친구와 대화는 이 앱의 서버에 저장됩니다. 같은 서버에 접속한 다른 계정과 실제로 메시지를 주고받을 수 있어요.</p><div className="demo-note"><CircleHelp size={18} /><p>두 창에서 대화해 보세요.<br /><b>young / seoyeon / minjun</b><br />데모 비밀번호: <b>12345678</b></p></div><button className="secondary full" onClick={async () => { try { await api('/auth/logout', 'POST'); logout(); } catch (error) { notify(error.message); } }}><LogOut size={16} />로그아웃</button></div></Modal>}
    {modal?.kind === 'leave' && <Modal title="채팅방 나가기" onClose={() => setModal(null)}><div className="confirm-content"><p>이 채팅방에서 나가시겠어요?</p><span>목록에서 채팅방이 사라집니다. 그룹채팅은 남은 참여자의 대화가 유지됩니다.</span><div className="modal-buttons"><button className="secondary" onClick={() => setModal(null)}>취소</button><button className="danger" onClick={async () => { try { await mutate(`/rooms/${roomId}`, 'DELETE', undefined, '채팅방에서 나왔어요'); setRoomId(null); setModal(null); } catch { /* shown */ } }}>나가기</button></div></div></Modal>}
    {modal?.kind === 'renameRoom' && <RenameRoom room={room} onClose={() => setModal(null)} onSave={async (name) => { await mutate(`/rooms/${roomId}`, 'PATCH', { name }, '채팅방 이름을 변경했어요'); setModal(null); }} />}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </div>;
}

function AddFriend({ api, onClose, onAdd }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const generation = useRef(0);
  async function search(event) {
    event.preventDefault(); const current = ++generation.current; setSearching(true); setSearched(true); setError('');
    try { const users = await api(`/users?q=${encodeURIComponent(query.trim())}`); if (generation.current === current) setResults(users); } catch (err) { setError(err.message); } finally { setSearching(false); }
  }
  return <Modal title="친구 추가" onClose={onClose}><div className="modal-body"><span className="field-section-label"><Hash size={15} />아이디로 친구 찾기</span><p className="subcopy">같은 서버에 가입한 친구의 아이디를 검색해 보세요.</p><form className="inline-search" onSubmit={search}><input aria-label="친구 아이디" placeholder="친구의 아이디 입력" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={30} required /><button className="primary" disabled={searching || !query.trim()}>{searching ? '검색 중' : '검색'}</button></form>{error && <p className="form-error" role="alert">{error}</p>}<div className="lookup-results">{results.map((person) => <div className="lookup-person" key={person.id}><Avatar person={person} /><span className="person-content"><b>{person.name}</b><span>@{person.handle}</span></span><button className="secondary compact" disabled={busy !== null} onClick={async () => { setBusy(person.id); try { await onAdd(person.handle); } catch (err) { setError(err.message); } finally { setBusy(null); } }}>{busy === person.id ? '추가 중' : '추가'}</button></div>)}{searched && !searching && !results.length && <div className="list-empty"><Search size={26} /><p>검색된 사용자가 없어요</p><span>친구가 이 서버에 가입했는지 확인해 주세요.</span></div>}{!searched && <div className="search-tip"><UserRoundPlus size={28} /><span>아이디를 알면 더 쉽게 만날 수 있어요.</span></div>}</div></div></Modal>;
}

function NewChat({ friends, onClose, onCreate }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState([]); const [name, setName] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="새로운 채팅" onClose={onClose}><div className="modal-body"><p className="subcopy">대화하고 싶은 친구를 선택하세요. 여러 명을 선택하면 그룹채팅을 시작해요.</p><div className="list-search modal-search"><Search size={16} /><input aria-label="대화 상대 검색" placeholder="이름 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="select-friends">{friends.filter((person) => `${label(person)} ${person.handle}`.toLowerCase().includes(query.toLowerCase())).map((person) => <button className="select-friend" key={person.id} onClick={() => setSelected((previous) => previous.includes(person.id) ? previous.filter((id) => id !== person.id) : [...previous, person.id])}><Avatar person={person} size="small" /><span>{label(person)}</span><span className={`checkbox ${selected.includes(person.id) ? 'checked' : ''}`}>{selected.includes(person.id) && <Check size={14} />}</span></button>)}{!friends.length && <p className="section-note">먼저 아이디로 친구를 추가해 주세요.</p>}</div>{selected.length > 1 && <label className="form-label">그룹채팅 이름 <span>(선택)</span><input aria-label="그룹채팅 이름" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 주말의 우리" maxLength={50} /></label>}<div className="modal-bottom"><span>{selected.length}명 선택</span><button className="primary" disabled={!selected.length || busy} onClick={async () => { setBusy(true); await onCreate(selected, name.trim()); setBusy(false); }}>{busy ? '만드는 중' : '대화 시작'}</button></div></div></Modal>;
}

function EditProfile({ me, onClose, onSave, onSelfChat }) {
  const [name, setName] = useState(me.name); const [status, setStatus] = useState(me.status || ''); const [color, setColor] = useState(me.avatarColor || COLORS[0]); const [busy, setBusy] = useState(false);
  return <Modal title="내 프로필" onClose={onClose}><form className="modal-body profile-edit" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await onSave({ name: name.trim(), status: status.trim(), avatarColor: color }); } catch { /* shown */ } finally { setBusy(false); } }}><Avatar person={{ ...me, name, avatarColor: color }} size="large" /><div className="color-picker" aria-label="프로필 색상">{COLORS.map((item) => <button key={item} type="button" aria-label={`프로필 색상 ${item}`} aria-pressed={color === item} style={{ background: item }} onClick={() => setColor(item)}>{color === item && <Check size={15} />}</button>)}</div><span className="profile-handle">@{me.handle}</span><label className="form-label">이름<input aria-label="프로필 이름" value={name} onChange={(event) => setName(event.target.value)} required maxLength={30} /></label><label className="form-label">상태메시지<input aria-label="상태메시지" placeholder="오늘의 기분을 알려주세요" value={status} onChange={(event) => setStatus(event.target.value)} maxLength={100} /></label><button type="button" className="secondary full" onClick={onSelfChat}><MessageCircle size={16} />나와의 채팅</button><button className="primary full" disabled={!name.trim() || busy}>{busy ? '저장 중' : '저장'}</button></form></Modal>;
}

function Profile({ person, isFriend, onClose, onChat, onChange, onAdd }) {
  const [alias, setAlias] = useState(person?.alias || ''); const [editing, setEditing] = useState(false); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  if (!person) return <Modal title="프로필" onClose={onClose}><p className="modal-body">프로필을 찾지 못했어요.</p></Modal>;
  const action = async (change, message, close = false) => { setBusy(true); try { await onChange(change, message); if (close) onClose(); setEditing(false); } catch { /* shown */ } finally { setBusy(false); } };
  return <Modal title="프로필" onClose={onClose} className="profile-modal"><div className="profile-cover" style={{ '--cover-color': person.avatarColor || COLORS[0] }} /><div className="profile-main"><Avatar person={person} size="large" /><h2>{label(person)} {isFriend && <button className="inline-icon" aria-label="친구 이름 변경" onClick={() => setEditing(!editing)}><Pencil size={14} /></button>}</h2><span className="profile-handle">@{person.handle}</span><p className="profile-status">{person.status || '아직 등록된 상태메시지가 없어요.'}</p>{editing && <form className="alias-editor" onSubmit={(event) => { event.preventDefault(); action({ alias: alias.trim() }, '친구 이름을 변경했어요'); }}><input aria-label="친구 표시 이름" placeholder={person.name} value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={30} /><button className="primary compact" disabled={busy}>저장</button></form>}<div className="profile-primary-actions"><button disabled={busy || person.blocked} onClick={onChat}><span><MessageCircle size={22} /></span>1:1 채팅</button>{isFriend ? <button disabled={busy} onClick={() => action({ favorite: !person.favorite }, person.favorite ? '즐겨찾기를 해제했어요' : '즐겨찾기에 추가했어요')}><span><Star size={22} fill={person.favorite ? '#e5bb41' : 'none'} /></span>{person.favorite ? '즐겨찾기 해제' : '즐겨찾기'}</button> : <button disabled={busy} onClick={async () => { setBusy(true); try { await onAdd(person.handle); } catch { /* shown */ } finally { setBusy(false); } }}><span><UserRoundPlus size={22} /></span>친구 추가</button>}</div>{isFriend && <div className="profile-minor-actions"><button disabled={busy} onClick={() => setConfirm('hidden')}>{person.hidden ? '숨김 해제' : '숨김'}</button><span /><button disabled={busy} onClick={() => setConfirm('blocked')}>{person.blocked ? '차단 해제' : '차단'}</button></div>}{confirm && <div className="inline-confirm"><b>{confirm === 'hidden' ? person.hidden ? '친구 목록에 다시 표시할까요?' : '친구 목록에서 숨길까요?' : person.blocked ? '차단을 해제할까요?' : '이 친구를 차단할까요?'}</b><p>{confirm === 'hidden' ? '숨긴 친구와도 대화할 수 있어요. 친구 관리에서 되돌릴 수 있어요.' : '차단하면 이 친구와 1:1 메시지를 주고받을 수 없어요. 그룹채팅에는 적용되지 않아요.'}</p><div><button className="secondary compact" onClick={() => setConfirm('')}>취소</button><button className="primary compact" disabled={busy} onClick={() => action({ [confirm]: !person[confirm] }, '친구 설정을 변경했어요', true)}>확인</button></div></div>}</div></Modal>;
}

function ManageFriends({ friends, onClose, onChange }) {
  const [tab, setTab] = useState('hidden'); const [busy, setBusy] = useState(null);
  const list = friends.filter((person) => tab === 'hidden' ? person.hidden && !person.blocked : person.blocked);
  return <Modal title="친구 관리" onClose={onClose}><div className="management-tabs"><button className={tab === 'hidden' ? 'active' : ''} onClick={() => setTab('hidden')}>숨김 친구</button><button className={tab === 'blocked' ? 'active' : ''} onClick={() => setTab('blocked')}>차단 친구</button></div><div className="modal-body"><p className="subcopy">{tab === 'hidden' ? '숨긴 친구는 목록에만 표시되지 않아요. 대화는 계속할 수 있어요.' : '차단한 친구와는 1:1 메시지를 주고받을 수 없어요.'}</p><div className="manage-list">{list.map((person) => <div className="lookup-person" key={person.id}><Avatar person={person} size="small" /><span className="person-content"><b>{label(person)}</b><span>@{person.handle}</span></span><button className="secondary compact" disabled={busy !== null} onClick={async () => { setBusy(person.id); try { await onChange(person.id, tab === 'hidden' ? { hidden: false } : { blocked: false, hidden: false }, tab === 'hidden' ? '친구 목록으로 복귀했어요' : '차단을 해제했어요'); } catch { /* shown */ } finally { setBusy(null); } }}>{tab === 'hidden' ? '숨김 해제' : '차단 해제'}</button></div>)}{!list.length && <div className="list-empty"><ShieldBan size={29} /><p>{tab === 'hidden' ? '숨긴 친구가 없어요' : '차단한 친구가 없어요'}</p></div>}</div></div></Modal>;
}

function RenameRoom({ room, onClose, onSave }) {
  const [name, setName] = useState(room?.name || ''); const [busy, setBusy] = useState(false);
  return <Modal title="채팅방 이름 변경" onClose={onClose}><form className="modal-body" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await onSave(name.trim()); } catch { /* shown */ } finally { setBusy(false); } }}><label className="form-label">채팅방 이름<input aria-label="새 채팅방 이름" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} required /></label><button className="primary full" disabled={!name.trim() || busy}>저장</button></form></Modal>;
}
