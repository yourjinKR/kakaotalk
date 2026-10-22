export interface User {
  id: string;
  handle: string;
  name: string;
  status: string;
  avatar: string;
  color: string;
}
export interface Friend extends User {
  favorite: boolean;
  state: "normal" | "hidden" | "blocked";
  alias: string;
}
export interface Message {
  id: number;
  roomId: string;
  senderId: string;
  text: string;
  createdAt: string;
  unread: number;
}
export interface Room {
  id: string;
  name: string;
  type: "direct" | "group" | "self";
  members: User[];
  lastMessage: { text: string; createdAt: string; senderId: string } | null;
  unread: number;
  pinned: boolean;
  muted: boolean;
  updatedAt: string;
}
export interface Bootstrap {
  user: User;
  friends: Friend[];
  rooms: Room[];
}
