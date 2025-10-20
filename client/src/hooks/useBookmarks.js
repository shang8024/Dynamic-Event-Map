// useBookmarks.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { postBatch } from '../services/api';
import { K, readJSON, writeJSON } from '../utils/storage';

const KEYS = { 
  BOOKMARKS: K.BOOKMARKS, 
  EVENTS: K.EVENTS, 
  QUEUE: K.QUEUE, 
  CURSOR: 'bm:eventsCursor' 
};

export function useBookmarks() {
  const [_tick, setTick] = useState(0); // Trigger re-renders
  const timer = useRef(null);

  const isBookmarked = useCallback((id) => {
    const bm = readJSON(KEYS.BOOKMARKS, {});
    return !!bm[id]?.on;
  }, []); // Remove tick dependency - function will get fresh data on each call

  const toggle = useCallback((id, next, eventData = null) => {
    const bm = readJSON(KEYS.BOOKMARKS, {});
    const ec = readJSON(KEYS.EVENTS, {}); // Events cache
    const now = Date.now();
    const target = typeof next === 'boolean' ? next : !bm[id]?.on;
    
    // Update bookmark status
    bm[id] = { on: target, updatedAt: now };
    writeJSON(KEYS.BOOKMARKS, bm);

    // Store event data if provided and bookmarking
    if (target && eventData) {
      ec[id] = {
        ...eventData,
        updatedAt: now
      };
      writeJSON(KEYS.EVENTS, ec);
    }

    // Queue operation and merge (keep only last state)
    const q = readJSON(KEYS.QUEUE, {});
    q[id] = target;
    writeJSON(KEYS.QUEUE, q);

    // Debounced sync
    if (timer.current) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(flushQueue, 1500);

    setTick(t => t + 1);
  }, []);

  const listBookmarkedIds = useCallback(() => {
    const bm = readJSON(KEYS.BOOKMARKS, {});
    return Object.keys(bm).filter(id => bm[id].on);
  }, []); // Remove tick dependency - function will get fresh data on each call

  const listBookmarkedEvents = useCallback(() => {
    const bm = readJSON(KEYS.BOOKMARKS, {});
    const ec = readJSON(KEYS.EVENTS, {});
    
    return Object.keys(bm)
      .filter(id => bm[id].on)
      .map(id => ({
        id,
        bookmarkInfo: bm[id],
        eventData: ec[id] || null // Event data might not exist for older bookmarks
      }))
      .sort((a, b) => b.bookmarkInfo.updatedAt - a.bookmarkInfo.updatedAt); // Most recent first
  }, []);

  async function flushQueue() {
    const q = readJSON(KEYS.QUEUE, {});
    const pairs = Object.entries(q);
    if (pairs.length === 0) return;
    
    const payload = pairs.map(([eventId, on]) => ({ 
      eventId, 
      bookmarked: on 
    }));
    
    try {
      await postBatch(payload);
      // Clear queue after successful sync
      writeJSON(KEYS.QUEUE, {});
    } catch (error) {
      console.warn('Failed to sync bookmarks:', error);
      // Network failure: keep queue, retry on online/visibilitychange
    }
  }

  useEffect(() => {
    const onOnline = () => flushQueue();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        flushQueue();
      }
    };
    
    // Cross-tab sync
    const onStorage = (e) => {
      if (e.key && [KEYS.BOOKMARKS, KEYS.EVENTS].includes(e.key)) {
        setTick(t => t + 1);
      }
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);

    // Initial flush on mount
    flushQueue();

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      if (timer.current) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  return { 
    isBookmarked, 
    toggle, 
    listBookmarkedIds,
    listBookmarkedEvents
  };
}