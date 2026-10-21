import { io } from "socket.io-client";
import { socketEndpoint } from "./endpoints";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const { url, path } = socketEndpoint(API_BASE, window.location.origin);

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
