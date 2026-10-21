// src/notifications/NotificationContext.jsx
import React, { createContext, useContext, useMemo, useReducer, useEffect, useCallback } from "react";
import socket from "../services/socket";

let idSeq = 1;
const NotificationCtx = createContext(null);

const initialState = {
  // { id, type, title, message, stickyKey, autoCloseMs }
  items: [],
};

function reducer(state, action) {
  switch (action.type) {
    case "PUSH": {
      const item = { id: action.id ?? idSeq++, ...action.payload };
      // if stickyKey is dismissed for today, skip
      if (item.stickyKey && isDismissedToday(item.stickyKey)) return state;
      return { ...state, items: [item, ...state.items] };
    }
    case "DISMISS": {
      const { id, stickyKey } = action;
      if (stickyKey) markDismissedToday(stickyKey);
      return { ...state, items: state.items.filter((x) => x.id !== id) };
    }
    case "CLEAR":
      return { ...state, items: [] };
    default:
      return state;
  }
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// eslint-disable-next-line react-refresh/only-export-components
export function isDismissedToday(key) {
  try {
    const raw = localStorage.getItem(`notif_dismiss_${key}`);
    if (!raw) return false;
    const { day } = JSON.parse(raw);
    return day === todayStamp();
  } catch {
    return false;
  }
}
function markDismissedToday(key) {
  try {
    localStorage.setItem(`notif_dismiss_${key}`, JSON.stringify({ day: todayStamp() }));
  } catch { /* Private browsing may disallow persistence. */ }
}

export function NotificationProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Wire Socket.IO broadcast -> push
  useEffect(() => {
    const handler = (payload) => {
      // expected: { type, title, message, stickyKey, autoCloseMs }
      dispatch({ type: "PUSH", payload });
    };
    socket.on("notify", handler);
    return () => socket.off("notify", handler);
  }, []);

  const push=useCallback(payload=>dispatch({type:'PUSH',payload}),[]);
  const dismiss=useCallback((id,stickyKey)=>dispatch({type:'DISMISS',id,stickyKey}),[]);
  const clear=useCallback(()=>dispatch({type:'CLEAR'}),[]);
  const api=useMemo(()=>({push,dismiss,clear,items:state.items}),[push,dismiss,clear,state.items]);

  return <NotificationCtx.Provider value={api}>{children}</NotificationCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const ctx = useContext(NotificationCtx);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
