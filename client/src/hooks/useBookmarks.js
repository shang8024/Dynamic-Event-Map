// src/hooks/useBookmarks.js
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchBookmarks, addBookmark, removeBookmark } from "../services/bookmarksService.js";

export function useBookmarks() {
  const [bookmarkedIds, setBookmarkedIds] = useState(() => new Set());
  const [items, setItems] = useState([]);        // [{ data: eventRow, created_at }]
  const [pendingIds, setPendingIds] = useState(() => new Set()); // <— NEW
  const loadingRef = useRef(false);

  const toEventData = useCallback((row) => {
    if (!row) return null;
    const { id, title, description, latitude, longitude, data } = row;
    const img = data?.image?.url ?? data?.data?.image?.url ?? null;
    const position =
      typeof latitude === "number" && typeof longitude === "number"
        ? { lat: latitude, lng: longitude }
        : null;
    return {
      id,
      title,
      description: description ?? data?.raw?.short_description ?? null,
      img,
      position,
      _row: row,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const { items: serverItems = [] } = await fetchBookmarks();
        if (cancelled) return;
        setItems(serverItems);
        const ids = new Set();
        for (const it of serverItems) {
          const evId = it?.data?.id;
          if (typeof evId === "number") ids.add(evId);
        }
        setBookmarkedIds(ids);
      } finally {
        loadingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isBookmarked = useCallback(
    (eventId) => bookmarkedIds.has(eventId),
    [bookmarkedIds]
  );

  // NEW: expose per-button loading state
  const isPending = useCallback(
    (eventId) => pendingIds.has(eventId),
    [pendingIds]
  );

  const toggle = useCallback(
    async (eventId, next, eventObj) => {
      const prev = bookmarkedIds.has(eventId);
      const willMark = typeof next === "boolean" ? next : !prev;

      // optimistic state
      setBookmarkedIds((old) => {
        const ns = new Set(old);
        if (willMark) ns.add(eventId);
        else ns.delete(eventId);
        return ns;
      });

      if (willMark) {
        const already = items.some((it) => it?.data?.id === eventId);
        if (!already && eventObj) {
          const rowLike = {
            id: eventId,
            title: eventObj.title ?? `Event ${eventId}`,
            description: eventObj.description ?? null,
            latitude: eventObj.position?.lat ?? null,
            longitude: eventObj.position?.lng ?? null,
            data: eventObj.data ?? {},
          };
          setItems((old) => [
            { data: rowLike, created_at: new Date().toISOString() },
            ...old,
          ]);
        }
      } else {
        setItems((old) => old.filter((it) => it?.data?.id !== eventId));
      }

      // mark this id as pending
      setPendingIds((s) => new Set(s).add(eventId));
      try {
        if (willMark) await addBookmark(eventId);
        else await removeBookmark(eventId);
      } catch {
        // rollback
        setBookmarkedIds((old) => {
          const ns = new Set(old);
          if (prev) ns.add(eventId);
          else ns.delete(eventId);
          return ns;
        });
        setItems((old) => {
          if (willMark) return old.filter((it) => it?.data?.id !== eventId);
          return old; // leaving as-is; user can refresh
        });
      } finally {
        // clear pending
        setPendingIds((s) => {
          const ns = new Set(s);
          ns.delete(eventId);
          return ns;
        });
      }
    },
    [bookmarkedIds, items]
  );

  const listBookmarkedEvents = useCallback(() => {
    return items.map((it) => {
      const eventData = toEventData(it.data);
      return {
        id: it?.data?.id ?? eventData?.id,
        eventData,
        bookmarkInfo: {
          updatedAt:
            it?.created_at ?? it?.data?.updated_at ?? new Date().toISOString(),
        },
      };
    });
  }, [items, toEventData]);

  return useMemo(
    () => ({
      isBookmarked,
      isPending,         // <— NEW
      toggle,
      listBookmarkedEvents,
    }),
    [isBookmarked, isPending, toggle, listBookmarkedEvents]
  );
}
