import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE_URL || `http://localhost:5000`;

// Create a singleton socket connection
const socket = io(API_BASE, { autoConnect: true });

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
