import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  UsersRound,
  MessageCircle,
  Search,
  Plus,
  UserRoundPlus,
  Settings2,
  LogOut,
  X,
  ChevronDown,
  ChevronLeft,
  Send,
  Smile,
  MoreHorizontal,
  Pin,
  BellOff,
  Check,
  CheckCheck,
  Star,
  ArrowRight,
  UserRound,
  SlidersHorizontal,
  CircleHelp,
  MessageCirclePlus,
  Pencil,
  ShieldBan,
  EyeOff,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { api, post, patch } from "./api";
import type { User, Friend, Room, Message, Bootstrap } from "./types";

const EMOJIS = [
  "😊",
  "🥰",
  "😂",
  "😍",
  "😎",
  "🥹",
  "👍",
  "👏",
  "💛",
  "🎉",
  "☕",
  "🍀",
  "🙌",
  "✨",
  "👀",
  "🤔",
];
const fmtTime = (date: string) =>
  new Date(date).toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  });
const fmtDate = (date: string) =>
  new Date(date).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
const shortTime = (date: string) =>
  new Date(date).toDateString() === new Date().toDateString()
    ? fmtTime(date)
    : new Date(date).toLocaleDateString("ko-KR", {
        month: "numeric",
        day: "numeric",
      });
function Avatar({
  user,
  size = "",
  group = false,
}: {
  user?: Partial<User>;
  size?: string;
  group?: boolean;
}) {
  return (
    <span
      className={`avatar ${size} ${group ? "group-avatar" : ""}`}
      style={{ background: user?.color || "#e7e4db" }}
    >
      {group ? (
        <UsersRound size={23} />
      ) : (
        user?.avatar || user?.name?.slice(0, 1) || <UserRound size={24} />
      )}
    </span>
  );
}
function IconButton({
  label,
  children,
  onClick,
  active,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusables = () =>
      ref.current?.querySelectorAll<HTMLElement>(
        'button,input,textarea,select,[tabindex="0"]',
      );
    focusables()?.[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = focusables();
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton label="닫기" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [register, setRegister] = useState(false),
    [handle, setHandle] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function submit(e?: FormEvent, demo?: string) {
    e?.preventDefault();
    setError("");
    setPending(true);
    try {
      await post(`/auth/${register && !demo ? "register" : "login"}`, {
        handle: demo || handle,
        password: demo ? "demo1234" : password,
        name,
      });
      await onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <MessageCircle fill="currentColor" size={25} />
          </span>
          카톡<span className="brand-label">우리의 작은 연결</span>
        </div>
        <div className="story-content">
          <span className="eyebrow">가까운 사람들과, 더 가깝게</span>
          <h1>
            별일 없는 하루도
            <br />
            나누면 특별하니까.
          </h1>
          <p>
            친구의 안부부터 오늘의 작은 이야기까지.
            <br />
            대화에만 집중하는 우리만의 공간.
          </p>
          <div className="story-chat">
            <div className="story-message">
              <span className="story-avatar">🌿</span>
              <div>
                <small>지윤</small>
                <p>오늘 하루는 어땠어? 😊</p>
              </div>
            </div>
            <div className="story-reply">
              <p>네 덕분에 조금 더 좋아졌어!</p>
              <span>읽음</span>
            </div>
            <div className="story-message last">
              <span className="story-avatar">🌿</span>
              <div>
                <p>그럼 내일도 이야기하자 💛</p>
              </div>
            </div>
          </div>
        </div>
        <div className="story-footer">
          친구와 대화, 필요한 것만 담았어요.<span>katalk / 01</span>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-card">
          <div className="small-brand">
            카톡
            <span className="yellow-dot" />
          </div>
          <h2>{register ? "반가워요, 새 친구!" : "다시 만나서 반가워요"}</h2>
          <p className="muted">
            {register
              ? "나만의 프로필로 이야기를 시작해 보세요."
              : "당신의 이야기가 기다리고 있어요."}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                이름
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={30}
                  placeholder="친구에게 보일 이름"
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              카톡 ID
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                required
                placeholder="아이디를 입력해 주세요"
                autoComplete="username"
              />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={register ? 8 : undefined}
                placeholder={
                  register
                    ? "8자 이상 입력해 주세요"
                    : "비밀번호를 입력해 주세요"
                }
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={pending}>
              {pending
                ? "연결하는 중…"
                : register
                  ? "가입하고 시작하기"
                  : "로그인"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? "이미 계정이 있나요?" : "처음 오셨나요?"}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "로그인" : "회원가입"}
            </button>
          </p>
          <div className="demo-divider">
            <span>먼저 둘러보세요</span>
          </div>
          <div className="demo-users">
            {[
              ["young", "김영", "🌻"],
              ["jiyoon", "이지윤", "🌿"],
              ["minjun", "박민준", "☕"],
              ["soyeon", "한소연", "🍊"],
            ].map(([id, label, emoji]) => (
              <button
                key={id}
                disabled={pending}
                onClick={() => submit(undefined, id)}
              >
                <span>{emoji}</span>
                {label}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
          <p className="demo-caption">
            예시 계정 · 비밀번호 demo1234
            <br />
            다른 브라우저에서 접속하면 서로 대화할 수 있어요.
          </p>
        </div>
        <p className="login-bottom">친구와 나누는 일상, 카톡</p>
      </section>
    </main>
  );
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [booting, setBooting] = useState(true),
    [bootError, setBootError] = useState("");
  const [tab, setTab] = useState<"friends" | "chats">("chats"),
    [activeId, setActiveId] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [query, setQuery] = useState(""),
    [draft, setDraft] = useState("");
  const [modal, setModal] = useState<
      "add" | "group" | "manage" | "settings" | "profile" | "help" | null
    >(null),
    [profile, setProfile] = useState<Friend | null>(null),
    [info, setInfo] = useState(false),
    [menu, setMenu] = useState(false),
    [searchChat, setSearchChat] = useState(false),
    [chatQuery, setChatQuery] = useState(""),
    [emoji, setEmoji] = useState(false),
    [connected, setConnected] = useState(false),
    [typing, setTyping] = useState<Record<string, string>>({}),
    [toast, setToast] = useState(""),
    [sending, setSending] = useState(false),
    [mobileChat, setMobileChat] = useState(false),
    [sort, setSort] = useState("latest");
  const activeRef = useRef(activeId),
    dataRef = useRef(data),
    scrollRef = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    loadSequence = useRef(0),
    refreshSequence = useRef(0),
    authEpoch = useRef(0),
    mobileRef = useRef(mobileChat),
    pendingSend = useRef<{ roomId: string; text: string; id: string } | null>(
      null,
    );
  activeRef.current = activeId;
  dataRef.current = data;
  mobileRef.current = mobileChat;
  const isReading = useCallback(
    (id: string) =>
      activeRef.current === id &&
      document.visibilityState === "visible" &&
      (!window.matchMedia("(max-width: 760px)").matches || mobileRef.current),
    [],
  );
  const closeModal = useCallback(() => {
    setModal(null);
    setProfile(null);
  }, []);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) notify(success);
    } catch (err) {
      notify((err as Error).message);
    }
  };
  const refresh = useCallback(async () => {
    const epoch = authEpoch.current,
      sequence = ++refreshSequence.current;
    const next = await api<Bootstrap>("/bootstrap");
    if (epoch !== authEpoch.current || sequence !== refreshSequence.current)
      return;
    const previous = dataRef.current;
    if (previous?.user.id === next.user.id) {
      for (const item of next.rooms) {
        const before = previous.rooms.find((r) => r.id === item.id);
        if (
          item.lastMessage &&
          item.lastMessage.senderId !== next.user.id &&
          !item.muted &&
          !isReading(item.id) &&
          (!before?.lastMessage ||
            item.lastMessage.createdAt > before.lastMessage.createdAt)
        ) {
          notify(
            `${item.type === "direct" ? item.members.find((m) => m.id !== next.user.id)?.name || item.name : item.name}: ${item.lastMessage.text.slice(0, 60)}`,
          );
        }
      }
    }
    dataRef.current = next;
    setData(next);
    if (
      !activeRef.current ||
      !next.rooms.some((r) => r.id === activeRef.current)
    )
      setActiveId(next.rooms[0]?.id || "");
  }, [isReading, notify]);
  useEffect(() => {
    api<{ user: User | null }>("/me")
      .then(async (result) => {
        if (result.user) await refresh();
      })
      .catch((err) => setBootError(err.message))
      .finally(() => setBooting(false));
  }, [refresh]);
  const room = data?.rooms.find((r) => r.id === activeId),
    user = data?.user;
  const loadMessages = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    const result = await api<{ messages: Message[] }>(`/rooms/${id}/messages`);
    if (activeRef.current === id && sequence === loadSequence.current)
      setMessages(result.messages);
  }, []);
  useEffect(() => {
    if (!activeId || !user) return;
    setMessages([]);
    setChatQuery("");
    setInfo(false);
    setMenu(false);
    setEmoji(false);
    setDraft(localStorage.getItem(`katalk:draft:${user.id}:${activeId}`) || "");
    void loadMessages(activeId)
      .then(() => {
        if (isReading(activeId)) return post(`/rooms/${activeId}/read`);
      })
      .catch((e) => notify(e.message));
  }, [activeId, user?.id, loadMessages, notify, isReading]);
  useEffect(() => {
    if (!user) return;
    const events = new EventSource("/api/events");
    events.onopen = () => {
      setConnected(true);
      void refresh()
        .then(() => {
          const id = activeRef.current;
          if (id) return loadMessages(id);
        })
        .catch(() => {});
    };
    events.onerror = () => setConnected(false);
    events.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "sync") {
          void refresh()
            .then(() => {
              const id = activeRef.current;
              if (id) void loadMessages(id).catch(() => {});
            })
            .catch(() => {});
        }
        if (
          event.type === "typing" &&
          event.roomId === activeRef.current &&
          event.userId !== user.id
        ) {
          setTyping((old) => ({
            ...old,
            [event.userId]: event.active
              ? new Date(Date.now() + 5000).toISOString()
              : "",
          }));
        }
      } catch {
        /* Ignore malformed events. */
      }
    };
    const timer = setInterval(
      () =>
        setTyping((old) =>
          Object.fromEntries(
            Object.entries(old).filter(
              ([, until]) => new Date(until).getTime() > Date.now(),
            ),
          ),
        ),
      2000,
    );
    return () => {
      events.close();
      clearInterval(timer);
      setConnected(false);
    };
  }, [user?.id, refresh, loadMessages]);
  useEffect(() => {
    if (room?.unread && isReading(room.id))
      void post(`/rooms/${room.id}/read`).catch(() => {});
  }, [room?.unread, room?.id, mobileChat, isReading]);
  useEffect(() => {
    const read = () => {
      const id = activeRef.current;
      if (id && isReading(id))
        void post(`/rooms/${id}/read`)
          .then(() => loadMessages(id))
          .catch(() => {});
    };
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    return () => {
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("focus", read);
    };
  }, [loadMessages, isReading]);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.at(-1)?.id, activeId]);
  const roomTitle = (item: Room) =>
    item.type === "self"
      ? "나와의 채팅"
      : item.type === "direct"
        ? item.members
            .filter((m) => m.id !== user?.id)
            .map(
              (m) => data?.friends.find((f) => f.id === m.id)?.alias || m.name,
            )
            .join(", ") || item.name
        : item.name;
  const roomUser = (item: Room) =>
    item.members.find((m) => m.id !== user?.id) || user;
  const openRoom = (id: string) => {
    setActiveId(id);
    setMobileChat(true);
    setProfile(null);
    setModal(null);
    setTyping({});
  };
  const startChat = async (ids: string[], name?: string) => {
    const result = await post<{ room: Room }>("/rooms", {
      memberIds: ids,
      name,
    });
    await refresh();
    openRoom(result.room.id);
    setTab("chats");
    setQuery("");
  };
  const changeFriend = async (id: string, changes: Partial<Friend>) => {
    await patch(`/friends/${id}`, changes);
    await refresh();
    setProfile((old) => (old?.id === id ? { ...old, ...changes } : old));
  };
  function updateDraft(value: string) {
    setDraft(value);
    if (user && activeId)
      localStorage.setItem(`katalk:draft:${user.id}:${activeId}`, value);
    if (activeId) {
      void post(`/rooms/${activeId}/typing`, { active: !!value }).catch(
        () => {},
      );
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      const roomId = activeId;
      typingTimeout.current = setTimeout(
        () =>
          void post(`/rooms/${roomId}/typing`, { active: false }).catch(
            () => {},
          ),
        2000,
      );
    }
  }
  async function send() {
    if (!draft.trim() || sending || !room || !user) return;
    const roomId = room.id,
      text = draft.trim();
    if (
      pendingSend.current?.roomId !== roomId ||
      pendingSend.current.text !== text
    )
      pendingSend.current = { roomId, text, id: crypto.randomUUID() };
    setSending(true);
    try {
      await post(`/rooms/${roomId}/messages`, {
        text,
        clientId: pendingSend.current.id,
      });
      pendingSend.current = null;
      if (activeRef.current === roomId) setDraft("");
      localStorage.removeItem(`katalk:draft:${user.id}:${roomId}`);
      setEmoji(false);
      await Promise.all([loadMessages(roomId), refresh()]);
      void post(`/rooms/${roomId}/typing`, { active: false }).catch(() => {});
      composer.current?.focus();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setSending(false);
    }
  }
  if (booting)
    return (
      <div className="loading-screen">
        <span className="brand-mark">
          <MessageCircle size={30} />
        </span>
        <p>카톡을 열고 있어요…</p>
      </div>
    );
  if (bootError)
    return (
      <div className="loading-screen">
        <h2>서버에 연결할 수 없어요</h2>
        <p>{bootError}</p>
        <button className="primary" onClick={() => location.reload()}>
          다시 연결
        </button>
      </div>
    );
  if (!data || !user) return <Login onLogin={refresh} />;
  const friends = data.friends.filter(
    (f) =>
      f.state === "normal" &&
      `${f.name} ${f.alias} ${f.handle}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const rooms = data.rooms
    .filter((r) =>
      `${roomTitle(r)} ${r.members.map((m) => m.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sort === "unread" ? b.unread - a.unread : 0) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const totalUnread = data.rooms.reduce((total, r) => total + r.unread, 0),
    otherTyping = Object.entries(typing)
      .filter(([, until]) => new Date(until).getTime() > Date.now())
      .map(([id]) => room?.members.find((m) => m.id === id)?.name)
      .filter(Boolean);
  const blocked =
    room?.type === "direct" &&
    data.friends.some(
      (f) => room.members.some((m) => m.id === f.id) && f.state === "blocked",
    );
  const visibleMessages = chatQuery
    ? messages.filter((m) =>
        m.text.toLowerCase().includes(chatQuery.toLowerCase()),
      )
    : messages;
  function friendRow(friend: Friend) {
    return (
      <button
        className="friend-row"
        key={friend.id}
        onClick={() => {
          setProfile(friend);
          setModal("profile");
        }}
      >
        <Avatar user={friend} />
        <span className="row-copy">
          <strong>{friend.alias || friend.name}</strong>
          <span>{friend.status || `@${friend.handle}`}</span>
        </span>
        {friend.favorite && (
          <Star size={13} className="favorite-star" fill="currentColor" />
        )}
      </button>
    );
  }
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <span className="wordmark">
          카톡
          <span className="tiny-dot" />
        </span>
        <span className="topbar-caption">친구와 나누는 일상</span>
        <span className={`connection ${connected ? "online" : ""}`}>
          <i />
          {connected ? "연결됨" : "다시 연결하는 중"}
        </span>
      </header>
      <div className="app-body">
        <nav className="rail" aria-label="메인 메뉴">
          <div className="rail-top">
            <IconButton
              label="친구"
              active={tab === "friends"}
              onClick={() => {
                setTab("friends");
                setQuery("");
                setMobileChat(false);
              }}
            >
              <UsersRound size={24} />
            </IconButton>
            <div className="rail-chat">
              <IconButton
                label="채팅"
                active={tab === "chats"}
                onClick={() => {
                  setTab("chats");
                  setQuery("");
                  setMobileChat(false);
                }}
              >
                <MessageCircle
                  size={24}
                  fill={tab === "chats" ? "currentColor" : "none"}
                />
              </IconButton>
              {totalUnread > 0 && (
                <span className="rail-badge">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </div>
          </div>
          <div className="rail-bottom">
            <IconButton label="이용 안내" onClick={() => setModal("help")}>
              <CircleHelp size={21} />
            </IconButton>
            <IconButton label="설정" onClick={() => setModal("settings")}>
              <Settings2 size={21} />
            </IconButton>
            <button
              className="my-avatar-button"
              title="내 프로필"
              onClick={() => setModal("settings")}
            >
              <Avatar user={user} size="small" />
            </button>
          </div>
        </nav>
        <aside className={`list-panel ${mobileChat ? "mobile-hidden" : ""}`}>
          <div className="list-heading">
            <div>
              <h1>{tab === "chats" ? "채팅" : "친구"}</h1>
              <span className="heading-count">
                {tab === "chats"
                  ? data.rooms.length
                  : data.friends.filter((f) => f.state === "normal").length}
              </span>
            </div>
            <div>
              {tab === "friends" ? (
                <>
                  <IconButton
                    label="친구 관리"
                    onClick={() => setModal("manage")}
                  >
                    <SlidersHorizontal size={19} />
                  </IconButton>
                  <IconButton label="친구 추가" onClick={() => setModal("add")}>
                    <UserRoundPlus size={21} />
                  </IconButton>
                </>
              ) : (
                <IconButton
                  label="새로운 채팅"
                  onClick={() => setModal("group")}
                >
                  <MessageCirclePlus size={22} />
                </IconButton>
              )}
            </div>
          </div>
          <div className="list-search">
            <Search size={17} />
            <input
              aria-label={tab === "chats" ? "채팅방 검색" : "친구 검색"}
              placeholder={
                tab === "chats"
                  ? "채팅방, 참여자 검색"
                  : "이름 또는 카톡 ID 검색"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="검색 지우기" onClick={() => setQuery("")}>
                <X size={14} />
              </button>
            )}
          </div>
          {tab === "chats" ? (
            <>
              <div className="list-section-label">
                <span>전체 대화</span>
                <label className="sort-select">
                  <select
                    aria-label="채팅 정렬"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="latest">최신순</option>
                    <option value="unread">안 읽은 순</option>
                  </select>
                  <ChevronDown size={12} />
                </label>
              </div>
              <div className="list-scroll">
                {rooms.map((item) => (
                  <button
                    className={`chat-row ${item.id === activeId ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => openRoom(item.id)}
                  >
                    <Avatar
                      user={roomUser(item)}
                      group={item.type === "group"}
                    />
                    <span className="row-copy">
                      <span className="row-title">
                        <strong>{roomTitle(item)}</strong>
                        {item.type === "self" && (
                          <span className="me-tag">나</span>
                        )}
                        {item.type === "group" && (
                          <small>{item.members.length}</small>
                        )}
                        {item.muted && <BellOff size={12} />}
                      </span>
                      <span className="preview">
                        {item.lastMessage?.text ||
                          "첫 번째 이야기를 시작해 보세요"}
                      </span>
                    </span>
                    <span className="row-meta">
                      <time>
                        {item.lastMessage
                          ? shortTime(item.lastMessage.createdAt)
                          : ""}
                      </time>
                      <span>
                        {item.pinned && <Pin size={12} />}{" "}
                        {item.unread > 0 && (
                          <b className="unread-badge">
                            {item.unread > 99 ? "99+" : item.unread}
                          </b>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
                {rooms.length === 0 && (
                  <div className="empty-list">
                    <MessageCircle size={30} />
                    <p>
                      {query
                        ? "검색 결과가 없어요"
                        : "친구와 첫 대화를 시작해 보세요"}
                    </p>
                    <button onClick={() => setModal("group")}>
                      새로운 채팅
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button
                className="friend-row my-profile"
                onClick={() => setModal("settings")}
              >
                <Avatar user={user} />
                <span className="row-copy">
                  <strong>
                    {user.name}
                    <span className="me-tag">나</span>
                  </strong>
                  <span>
                    {user.status || "나만의 상태메시지를 적어 보세요"}
                  </span>
                </span>
                <ChevronDown size={14} />
              </button>
              <div className="list-scroll">
                {friends.some((f) => f.favorite) && (
                  <>
                    <div className="list-section-label">
                      <span>
                        즐겨찾기{" "}
                        <small>
                          {friends.filter((f) => f.favorite).length}
                        </small>
                      </span>
                      <Star size={12} />
                    </div>
                    {friends.filter((f) => f.favorite).map(friendRow)}
                  </>
                )}
                <div className="list-section-label">
                  <span>
                    친구 <small>{friends.length}</small>
                  </span>
                  <button
                    onClick={() => setModal("add")}
                    aria-label="친구 목록에서 추가"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {friends.map(friendRow)}
                {friends.length === 0 && (
                  <div className="empty-list">
                    <UsersRound size={30} />
                    <p>
                      {query
                        ? "검색 결과가 없어요"
                        : "새로운 친구를 추가해 보세요"}
                    </p>
                    <button onClick={() => setModal("add")}>친구 추가</button>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="list-footer">
            <span className="yellow-dot" />
            <span>마음을 잇는 작은 대화</span>
          </div>
        </aside>
        <main className={`conversation ${mobileChat ? "mobile-visible" : ""}`}>
          {room ? (
            <>
              <header className="conversation-header">
                <IconButton
                  label="목록으로 돌아가기"
                  className="mobile-back"
                  onClick={() => setMobileChat(false)}
                >
                  <ChevronLeft size={22} />
                </IconButton>
                <button
                  className="conversation-person"
                  onClick={() => setInfo(!info)}
                >
                  <Avatar
                    user={roomUser(room)}
                    size="small"
                    group={room.type === "group"}
                  />
                  <span>
                    <h2>
                      {roomTitle(room)}
                      {room.type === "self" && (
                        <span className="me-tag">나</span>
                      )}
                    </h2>
                    <small>
                      {room.type === "group"
                        ? `${room.members.length}명의 친구와 함께`
                        : room.type === "self"
                          ? "기억하고 싶은 순간을 남겨 보세요"
                          : roomUser(room)?.status ||
                            "둘만의 이야기를 나눠 보세요"}
                    </small>
                  </span>
                </button>
                <div className="conversation-tools">
                  <IconButton
                    label="대화 내용 검색"
                    active={searchChat}
                    onClick={() => {
                      setSearchChat(!searchChat);
                      setChatQuery("");
                    }}
                  >
                    <Search size={20} />
                  </IconButton>
                  <IconButton
                    label="채팅방 정보"
                    active={info}
                    onClick={() => setInfo(!info)}
                  >
                    <UsersRound size={20} />
                  </IconButton>
                  <div className="menu-anchor">
                    <IconButton
                      label="채팅방 메뉴"
                      active={menu}
                      onClick={() => setMenu(!menu)}
                    >
                      <MoreHorizontal size={23} />
                    </IconButton>
                    {menu && (
                      <>
                        <div
                          className="menu-backdrop"
                          onClick={() => setMenu(false)}
                        />
                        <div className="dropdown">
                          <button
                            onClick={() =>
                              act(async () => {
                                await patch(`/rooms/${room.id}`, {
                                  pinned: !room.pinned,
                                });
                                setMenu(false);
                                await refresh();
                              })
                            }
                          >
                            <Pin size={16} />
                            {room.pinned ? "상단 고정 해제" : "상단 고정"}
                          </button>
                          <button
                            onClick={() =>
                              act(async () => {
                                await patch(`/rooms/${room.id}`, {
                                  muted: !room.muted,
                                });
                                setMenu(false);
                                await refresh();
                              })
                            }
                          >
                            <BellOff size={16} />
                            {room.muted ? "알림 켜기" : "알림 끄기"}
                          </button>
                          <button
                            className="danger"
                            onClick={() => {
                              setMenu(false);
                              setInfo(true);
                            }}
                          >
                            <LogOut size={16} />
                            채팅방 나가기
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </header>
              {searchChat && (
                <div className="chat-search-bar">
                  <Search size={17} />
                  <input
                    aria-label="대화 검색어"
                    autoFocus
                    placeholder="최근 200개 메시지에서 검색"
                    value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)}
                  />
                  <span>{chatQuery ? `${visibleMessages.length}개` : ""}</span>
                  <IconButton
                    label="대화 검색 닫기"
                    onClick={() => {
                      setSearchChat(false);
                      setChatQuery("");
                    }}
                  >
                    <X size={16} />
                  </IconButton>
                </div>
              )}
              <div className="conversation-content">
                <div className="message-column">
                  <div className="message-scroller" ref={scrollRef}>
                    <div className="chat-beginning">
                      <span>
                        <MessageCircle size={13} />
                        우리의 이야기가 머무는 곳
                      </span>
                    </div>
                    {visibleMessages.map((message, index) => {
                      const mine = message.senderId === user.id,
                        sender = room.members.find(
                          (m) => m.id === message.senderId,
                        );
                      const previous = visibleMessages[index - 1],
                        newDay =
                          !previous ||
                          new Date(previous.createdAt).toDateString() !==
                            new Date(message.createdAt).toDateString(),
                        grouped =
                          !!previous &&
                          !newDay &&
                          previous.senderId === message.senderId &&
                          new Date(message.createdAt).getTime() -
                            new Date(previous.createdAt).getTime() <
                            60000;
                      return (
                        <div key={message.id}>
                          {newDay && (
                            <div className="date-divider">
                              <span>{fmtDate(message.createdAt)}</span>
                            </div>
                          )}
                          <div
                            className={`message-row ${mine ? "mine" : "theirs"} ${grouped ? "grouped" : ""}`}
                          >
                            {!mine && !grouped ? (
                              <Avatar user={sender} size="message-avatar" />
                            ) : !mine ? (
                              <span className="avatar-spacer" />
                            ) : null}
                            <div className="message-body">
                              {!mine && !grouped && (
                                <span className="sender-name">
                                  {sender?.name || "이전 참여자"}
                                </span>
                              )}
                              <div className="bubble-line">
                                <div className="bubble">{message.text}</div>
                                <div className="message-meta">
                                  {mine && message.unread > 0 && (
                                    <span
                                      className="message-unread"
                                      title="아직 읽지 않은 참여자 수"
                                    >
                                      {message.unread}
                                    </span>
                                  )}
                                  <time>{fmtTime(message.createdAt)}</time>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {visibleMessages.length === 0 && (
                      <div className="empty-conversation">
                        <MessageCircle size={36} />
                        <h3>
                          {chatQuery
                            ? "일치하는 메시지가 없어요"
                            : "가벼운 인사부터 시작해 볼까요?"}
                        </h3>
                        <p>
                          {chatQuery
                            ? "다른 검색어를 입력해 보세요."
                            : "첫 번째 메시지로 이야기를 열어 주세요."}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="typing-indicator">
                    {otherTyping.length > 0 && (
                      <>
                        <span className="typing-dots">•••</span>
                        {otherTyping.join(", ")} 님이 입력하고 있어요
                      </>
                    )}
                  </div>
                  <div className="composer-area">
                    {blocked ? (
                      <div className="blocked-composer">
                        <ShieldBan size={18} />
                        차단한 친구예요. 친구 관리에서 차단을 해제해 주세요.
                      </div>
                    ) : (
                      <>
                        <textarea
                          ref={composer}
                          aria-label="메시지 입력"
                          placeholder="메시지를 입력하세요"
                          value={draft}
                          maxLength={4000}
                          disabled={sending}
                          onChange={(e) => updateDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              !e.shiftKey &&
                              !e.nativeEvent.isComposing
                            ) {
                              e.preventDefault();
                              void send();
                            }
                          }}
                        />
                        <div className="composer-bottom">
                          <div className="emoji-anchor">
                            <IconButton
                              label="이모지 선택"
                              active={emoji}
                              onClick={() => setEmoji(!emoji)}
                            >
                              <Smile size={22} />
                            </IconButton>
                            {emoji && (
                              <div className="emoji-picker" aria-label="이모지">
                                {EMOJIS.map((item) => (
                                  <button
                                    key={item}
                                    aria-label={item}
                                    onClick={() => {
                                      updateDraft(draft + item);
                                      composer.current?.focus();
                                    }}
                                  >
                                    {item}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="send-tools">
                            <span>
                              {draft.length > 3500
                                ? `${draft.length}/4000`
                                : "Enter로 전송 · Shift + Enter로 줄바꿈"}
                            </span>
                            <button
                              className="send-button"
                              aria-label="메시지 전송"
                              disabled={!draft.trim() || sending}
                              onClick={() => void send()}
                            >
                              전송
                              <Send size={15} />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {info && (
                  <RoomInfo
                    room={room}
                    user={user}
                    title={roomTitle(room)}
                    onClose={() => setInfo(false)}
                    onUpdate={refresh}
                    onLeave={() => {
                      setActiveId("");
                      setMobileChat(false);
                      void refresh();
                    }}
                    notify={notify}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="no-room">
              <span className="welcome-icon">
                <MessageCircle size={42} />
              </span>
              <h2>오늘은 어떤 이야기를 나눌까요?</h2>
              <p>친구를 선택하거나 새로운 대화를 시작해 보세요.</p>
              <button className="primary" onClick={() => setModal("group")}>
                대화 시작하기
                <Plus size={17} />
              </button>
            </div>
          )}
        </main>
      </div>
      {modal === "add" && (
        <AddFriend
          onClose={closeModal}
          friends={data.friends}
          onAdded={refresh}
          notify={notify}
        />
      )}
      {modal === "group" && (
        <NewChat
          friends={data.friends.filter((f) => f.state === "normal")}
          onClose={closeModal}
          onCreate={startChat}
        />
      )}
      {modal === "profile" && profile && (
        <Profile
          friend={profile}
          onClose={closeModal}
          onChat={() => act(() => startChat([profile.id]))}
          onUpdate={(changes) => act(() => changeFriend(profile.id, changes))}
          onDelete={() =>
            act(async () => {
              await api(`/friends/${profile.id}`, { method: "DELETE" });
              closeModal();
              await refresh();
            }, "친구를 삭제했어요.")
          }
        />
      )}
      {modal === "manage" && (
        <ManageFriends
          friends={data.friends}
          onClose={closeModal}
          onUpdate={(id, changes) => act(() => changeFriend(id, changes))}
        />
      )}
      {modal === "settings" && (
        <Settings
          user={user}
          onClose={closeModal}
          onUpdate={refresh}
          onSelfChat={() => act(() => startChat([]))}
          onLogout={() =>
            act(async () => {
              authEpoch.current++;
              refreshSequence.current++;
              loadSequence.current++;
              await post("/auth/logout");
              dataRef.current = null;
              activeRef.current = "";
              setData(null);
              setActiveId("");
              setMessages([]);
              setToast("");
              closeModal();
            })
          }
        />
      )}
      {modal === "help" && (
        <Modal title="카톡 이용 안내" onClose={closeModal}>
          <div className="help-content">
            <span className="help-logo">
              <MessageCircle size={35} />
            </span>
            <h3>친구와 대화에 집중하는 공간</h3>
            <p>
              친구 탭에서 ID로 친구를 추가하고, 프로필에서 즐겨찾기·숨김·차단을
              관리할 수 있어요.
            </p>
            <p>
              채팅 탭의 새 대화 버튼으로 1:1 또는 그룹 채팅을 시작하세요. 대화
              내용과 친구 목록은 이 PC의 서버에 저장돼요.
            </p>
            <p>
              다른 브라우저 또는 시크릿 창에서 같은 주소에 접속해 다른 예시
              계정으로 로그인하면 실시간 대화를 확인할 수 있어요.
            </p>
            <div className="help-note">
              독립적으로 만든 로컬 메신저 v0.1
              <br />
              예시 계정과 대화가 포함되어 있어요. 카카오 계정과 연동되지 않아요.
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function AddFriend({
  onClose,
  friends,
  onAdded,
  notify,
}: {
  onClose: () => void;
  friends: Friend[];
  onAdded: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<User[]>([]),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ users: User[] }>(
        `/users?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(data.users);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="친구 추가" onClose={onClose}>
      <p className="modal-description">
        친구의 카톡 ID 또는 이름으로 찾아보세요.
      </p>
      <form className="inline-form" onSubmit={search}>
        <input
          aria-label="추가할 친구 ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="카톡 ID 또는 이름"
          autoFocus
        />
        <button className="primary" disabled={busy || !query.trim()}>
          검색
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="search-results">
        {results.map((person) => {
          const friend = friends.find((f) => f.id === person.id);
          return (
            <div className="result-row" key={person.id}>
              <Avatar user={person} />
              <div>
                <strong>{person.name}</strong>
                <small>@{person.handle}</small>
              </div>
              <button
                className={friend ? "subtle-button" : "primary small-button"}
                disabled={!!friend || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await post("/friends", { userId: person.id });
                    await onAdded();
                    notify(`${person.name} 님을 친구로 추가했어요.`);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {friend ? (
                  friend.state === "blocked" ? (
                    "차단한 친구"
                  ) : friend.state === "hidden" ? (
                    "숨긴 친구"
                  ) : (
                    "추가됨"
                  )
                ) : (
                  <>
                    <Plus size={15} />
                    추가
                  </>
                )}
              </button>
            </div>
          );
        })}
        {searched && !results.length && (
          <div className="empty-list">
            <Search size={27} />
            <p>일치하는 사용자가 없어요.</p>
          </div>
        )}
        {!searched && (
          <div className="search-tip">
            <UserRoundPlus size={28} />
            <p>친구의 새로운 이야기를 만나보세요.</p>
            <small>예시 ID: young, jiyoon, minjun, soyeon</small>
          </div>
        )}
      </div>
    </Modal>
  );
}
function NewChat({
  friends,
  onClose,
  onCreate,
}: {
  friends: Friend[];
  onClose: () => void;
  onCreate: (ids: string[], name?: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [name, setName] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="새로운 채팅" onClose={onClose}>
      <p className="modal-description">함께 이야기할 친구를 선택해 주세요.</p>
      <div className="list-search modal-search">
        <Search size={16} />
        <input
          aria-label="대화할 친구 검색"
          placeholder="친구 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="select-friends">
        {friends
          .filter((f) => `${f.name} ${f.alias}`.includes(query))
          .map((friend) => (
            <button
              key={friend.id}
              className="select-friend"
              onClick={() =>
                setSelected((old) =>
                  old.includes(friend.id)
                    ? old.filter((id) => id !== friend.id)
                    : [...old, friend.id],
                )
              }
            >
              <Avatar user={friend} size="small" />
              <strong>{friend.alias || friend.name}</strong>
              <span
                className={`checkbox ${selected.includes(friend.id) ? "checked" : ""}`}
              >
                {selected.includes(friend.id) && <Check size={14} />}
              </span>
            </button>
          ))}
        {friends.length === 0 && (
          <p className="empty-list">친구를 먼저 추가해 주세요.</p>
        )}
      </div>
      {selected.length > 1 && (
        <label className="field-label">
          채팅방 이름
          <input
            placeholder="예: 우리들의 작은 모임"
            value={name}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <span>{selected.length}명 선택</span>
        <button
          className="primary"
          disabled={!selected.length || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onCreate(selected, name || undefined);
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "만드는 중…" : "대화 시작"}
          <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
function Profile({
  friend,
  onClose,
  onChat,
  onUpdate,
  onDelete,
}: {
  friend: Friend;
  onClose: () => void;
  onChat: () => void;
  onUpdate: (changes: Partial<Friend>) => void;
  onDelete: () => void;
}) {
  const [alias, setAlias] = useState(friend.alias || ""),
    [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState(false);
  return (
    <Modal title="친구 프로필" onClose={onClose}>
      <div
        className="profile-cover"
        style={{ background: `${friend.color || "#d8e2d2"}66` }}
      >
        <Avatar user={friend} size="large" />
        <h2>{friend.alias || friend.name}</h2>
        <span>@{friend.handle}</span>
        <p>{friend.status || "안녕하세요!"}</p>
      </div>
      <div className="profile-actions">
        <button onClick={onChat}>
          <span>
            <MessageCircle size={21} />
          </span>
          1:1 채팅
        </button>
        <button
          className={friend.favorite ? "is-favorite" : ""}
          onClick={() => onUpdate({ favorite: !friend.favorite })}
        >
          <span>
            <Star size={21} fill={friend.favorite ? "currentColor" : "none"} />
          </span>
          {friend.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
        </button>
        <button onClick={() => setEditing(!editing)}>
          <span>
            <Pencil size={20} />
          </span>
          이름 변경
        </button>
      </div>
      {editing && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            onUpdate({ alias });
            setEditing(false);
          }}
        >
          <input
            aria-label="친구 별명"
            placeholder={friend.name}
            value={alias}
            maxLength={30}
            onChange={(e) => setAlias(e.target.value)}
          />
          <button className="primary">저장</button>
        </form>
      )}
      <div className="profile-management">
        <button
          onClick={() => {
            onUpdate({ state: "hidden" });
            onClose();
          }}
        >
          <EyeOff size={16} />
          친구 숨김
        </button>
        <button
          onClick={() => {
            onUpdate({ state: "blocked" });
            onClose();
          }}
        >
          <ShieldBan size={16} />
          친구 차단
        </button>
        <button className="danger" onClick={() => setConfirm(true)}>
          <Trash2 size={16} />
          친구 삭제
        </button>
      </div>
      {confirm && (
        <div className="inline-confirm">
          <p>친구 목록에서 삭제할까요? 기존 대화는 유지돼요.</p>
          <button className="danger-button" onClick={onDelete}>
            삭제하기
          </button>
          <button className="subtle-button" onClick={() => setConfirm(false)}>
            취소
          </button>
        </div>
      )}
    </Modal>
  );
}
function ManageFriends({
  friends,
  onClose,
  onUpdate,
}: {
  friends: Friend[];
  onClose: () => void;
  onUpdate: (id: string, changes: Partial<Friend>) => void;
}) {
  const [state, setState] = useState<"hidden" | "blocked">("hidden");
  const items = friends.filter((f) => f.state === state);
  return (
    <Modal title="친구 관리" onClose={onClose}>
      <div className="segmented">
        <button
          className={state === "hidden" ? "active" : ""}
          onClick={() => setState("hidden")}
        >
          숨김 친구 {friends.filter((f) => f.state === "hidden").length}
        </button>
        <button
          className={state === "blocked" ? "active" : ""}
          onClick={() => setState("blocked")}
        >
          차단 친구 {friends.filter((f) => f.state === "blocked").length}
        </button>
      </div>
      <p className="modal-description">
        {state === "hidden"
          ? "친구 목록에서 숨긴 친구예요. 다시 표시할 수 있어요."
          : "차단한 친구와는 1:1 메시지를 주고받을 수 없어요."}
      </p>
      <div className="select-friends">
        {items.map((friend) => (
          <div className="result-row" key={friend.id}>
            <Avatar user={friend} size="small" />
            <div>
              <strong>{friend.alias || friend.name}</strong>
              <small>@{friend.handle}</small>
            </div>
            <button
              className="secondary small-button"
              onClick={() => onUpdate(friend.id, { state: "normal" })}
            >
              {state === "hidden" ? "다시 표시" : "차단 해제"}
            </button>
          </div>
        ))}
        {!items.length && (
          <div className="empty-list">
            <CheckCheck size={30} />
            <p>{state === "hidden" ? "숨긴" : "차단한"} 친구가 없어요.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
function Settings({
  user,
  onClose,
  onUpdate,
  onSelfChat,
  onLogout,
}: {
  user: User;
  onClose: () => void;
  onUpdate: () => Promise<void>;
  onSelfChat: () => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(user.name),
    [status, setStatus] = useState(user.status),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="내 프로필과 설정" onClose={onClose}>
      <div className="settings-profile">
        <Avatar user={user} size="large" />
        <span>
          <strong>{user.name}</strong>
          <small>@{user.handle}</small>
        </span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setSaved(false);
          setError("");
          try {
            await patch("/me", { name, status });
            await onUpdate();
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          이름
          <input
            value={name}
            maxLength={30}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field-label">
          상태메시지
          <input
            value={status}
            maxLength={100}
            placeholder="오늘의 기분을 알려 주세요"
            onChange={(e) => setStatus(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy || !name.trim()}>
          {saved ? (
            <>
              <Check size={16} />
              저장했어요
            </>
          ) : (
            "프로필 저장"
          )}
        </button>
      </form>
      <div className="settings-links">
        <button onClick={onSelfChat}>
          <MessageCircle size={18} />
          나와의 채팅
          <ArrowRight size={16} />
        </button>
        <button onClick={onLogout}>
          <LogOut size={18} />
          로그아웃
          <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
function RoomInfo({
  room,
  user,
  title,
  onClose,
  onUpdate,
  onLeave,
  notify,
}: {
  room: Room;
  user: User;
  title: string;
  onClose: () => void;
  onUpdate: () => Promise<void>;
  onLeave: () => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(room.name),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <aside className="room-info">
      <div className="room-info-heading">
        <h3>채팅방 정보</h3>
        <IconButton label="채팅방 정보 닫기" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="room-info-cover">
        <Avatar
          user={room.members.find((m) => m.id !== user.id) || user}
          group={room.type === "group"}
          size="large"
        />
        <h3>{title}</h3>
        <span>
          {room.type === "self"
            ? "나만의 공간"
            : `${room.members.length}명이 함께하는 대화`}
        </span>
      </div>
      {room.type === "group" && (
        <form
          className="room-name-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await patch(`/rooms/${room.id}`, { name });
              await onUpdate();
              notify("채팅방 이름을 변경했어요.");
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        >
          <label>
            채팅방 이름
            <input
              aria-label="채팅방 이름 변경"
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={!name.trim()}>
            변경
          </button>
        </form>
      )}
      <div className="info-label">
        대화 상대 <span>{room.members.length}</span>
      </div>
      <div className="room-members">
        {room.members.map((member) => (
          <div key={member.id}>
            <Avatar user={member} size="tiny" />
            <strong>{member.name}</strong>
            {member.id === user.id && <span className="me-tag">나</span>}
          </div>
        ))}
      </div>
      <div className="room-info-bottom">
        {confirm ? (
          <div className="leave-confirm">
            <p>
              이 채팅방을 나갈까요?
              <br />
              목록에서 대화가 사라져요.
            </p>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/rooms/${room.id}`, { method: "DELETE" });
                  onLeave();
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              나가기
            </button>
            <button className="subtle-button" onClick={() => setConfirm(false)}>
              취소
            </button>
          </div>
        ) : (
          <button className="leave-room" onClick={() => setConfirm(true)}>
            <LogOut size={16} />
            채팅방 나가기
          </button>
        )}
      </div>
    </aside>
  );
}
