// src/hooks/useBookmarks.js
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchBookmarks, addBookmark, removeBookmark } from "../services/bookmarksService.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export function useBookmarks() {
  const [bookmarkedIds, setBookmarkedIds] = useState(() => new Set());
  const [items, setItems] = useState([]); // [{ data: eventRow, created_at }]
  const [pendingIds, setPendingIds] = useState(() => new Set()); // <— NEW
  const latestRunRef = useRef(false);
  const { user } = useAuth();

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
    if (!user) {
      setBookmarkedIds(new Set());
      setItems([]);
      return;
    }
    const runId = Symbol();
    latestRunRef.current = runId;

    (async () => {
      try {
        const { items: serverItems = [] } = await fetchBookmarks();
        if (cancelled || latestRunRef.current !== runId) return;
        setItems(serverItems);
        const ids = new Set(
          serverItems
            .map((it) => (typeof it?.data?.id === "number" ? it.data.id : undefined))
            .filter((n) => typeof n === "number")
        );
        setBookmarkedIds(ids);
      } finally {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const isBookmarked = useCallback((eventId) => bookmarkedIds.has(eventId), [bookmarkedIds]);

  // NEW: expose per-button loading state
  const isPending = useCallback((eventId) => pendingIds.has(eventId), [pendingIds]);

  const toggle = useCallback(
    async (eventId, next, eventObj) => {
      if (!user) {
        throw new Error("User not authenticated");
      }
      const prev = bookmarkedIds.has(eventId);
      const willMark = typeof next === "boolean" ? next : !prev;

      // optimistic state
      setBookmarkedIds((old) => {
        const ns = new Set(old);
        if (willMark) ns.add(eventId);
        else ns.delete(eventId);
        return ns;
      });
      // mark this id as pending
      setPendingIds((s) => new Set(s).add(eventId));
      try {
        if (willMark) {
          const result = await addBookmark(eventId);
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
              { data: rowLike, created_at: new Date().toISOString(), id: result.id },
              ...old,
            ]);
          } else {
            setItems((old) => {
              return old.map((it) => {
                if (it?.data?.id === eventId && it.id !== result.id) {
                  return { data: it.data, created_at: it.created_at, id: result.id };
                }
                return it;
              });
            });
          }
        } else {
          let bookmarkId = items.find((it) => it?.data?.id === eventId)?.id;
          if (bookmarkId) {
            await removeBookmark(bookmarkId);
            setItems((old) => old.filter((it) => it?.data?.id !== eventId));
          } else {
            throw new Error("Bookmark ID not found for removal");
          }
        }
      } catch {
        // Handle errors (e.g., revert optimistic update)
        setBookmarkedIds((old) => {
          const ns = new Set(old);
          if (prev) ns.add(eventId);
          else ns.delete(eventId);
          return ns;
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
    [bookmarkedIds, items, user]
  );

  const listBookmarkedEvents = useCallback(() => {
    if (!user) {
      return [];
    }
    return items.map((it) => {
      const eventData = toEventData(it.data);
      return {
        id: it?.data?.id ?? eventData?.id,
        eventData,
        bookmarkInfo: {
          updatedAt: it?.created_at ?? it?.data?.updated_at ?? new Date().toISOString(),
        },
      };
    });
  }, [items, toEventData, user]);

  return useMemo(
    () => ({
      isBookmarked,
      isPending,
      toggle,
      listBookmarkedEvents,
    }),
    [isBookmarked, isPending, toggle, listBookmarkedEvents]
  );
}
