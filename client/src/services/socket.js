import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE_URL || `http://localhost:5000`;

function socketTarget(apiBase, origin) {
  const trimmed = apiBase.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, path: "/socket.io" };
  }
  return { url: origin, path: `${trimmed || ""}/socket.io` };
}

const { url, path } = socketTarget(API_BASE, window.location.origin);

const socket = io(url, {
  path,
  autoConnect: true,
  transports: ["polling", "websocket"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  timeout: 20000,
});

export default socket;

export function on(event, cb) {
  socket.on(event, cb);
}

export function off(event, cb) {
  socket.off(event, cb);
}

export function emit(event, payload) {
  socket.emit(event, payload);
}
