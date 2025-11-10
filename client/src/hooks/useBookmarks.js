// src/hooks/useBookmarks.js
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchBookmarks, addBookmark, removeBookmark, fetchTodaysBookmarks } from "../services/bookmarksService.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useNotifications, isDismissedToday } from "../contexts/NotificationContext.jsx";

export function useBookmarks() {
  const [bookmarkedIds, setBookmarkedIds] = useState(() => new Set());
  const [items, setItems] = useState([]); // [{ data: eventRow, created_at }]
  const [pendingIds, setPendingIds] = useState(() => new Set()); // <— NEW
  const latestRunRef = useRef(false);
  const { user } = useAuth();
  const { push } = useNotifications();

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
      } catch {
        push({ type: "error", message: "Failed to load bookmarks", autoCloseMs: 5000 });
      }
    })();
    (async () => {
      try {
        // if currently is '/bookmarks', skip notification
        if (window.location.pathname === "/bookmarks") return;
        // if dimissed already, skip
        if (isDismissedToday("todays-bookmarks")) return;
        const todays = await fetchTodaysBookmarks();
        if (cancelled || latestRunRef.current !== runId) return;
        // push notification if there are any
        const totalCount = (todays[0]?.total ?? 0) + (todays[1]?.total ?? 0);
        if (totalCount > 0) {
          push({
            type: "info",
            message: `You have ${todays[0]?.total ?? 0} bookmarked events starting and ${todays[1]?.total ?? 0} ending today.`,
            autoCloseMs: 10000,
            stickyKey: "todays-bookmarks",
            action: {
              label: "View",
              onClick: () => {},
              href: "/bookmarks",
            }
          });
        }
      } catch {
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
        push({ type: "error", message: "User not authenticated", autoCloseMs: 5000 });
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
          push({ type: "success", message: "Bookmark added successfully", autoCloseMs: 2000 });
        } else {
          let bookmarkId = items.find((it) => it?.data?.id === eventId)?.id;
          if (bookmarkId) {
            await removeBookmark(bookmarkId);
            setItems((old) => old.filter((it) => it?.data?.id !== eventId));
            push({ type: "success", message: "Bookmark removed successfully", autoCloseMs: 2000 });
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
        push({ type: "error", message: "Failed to update bookmark", autoCloseMs: 5000 });
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
