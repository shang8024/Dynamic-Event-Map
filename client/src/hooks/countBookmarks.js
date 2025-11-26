import { useState, useEffect } from "react";
import socket from "../services/socket";
import { fetchBookmarkStats } from "../services/bookmarksService";

export function useCountBookmarks(eventId) {
  const [numBookmarks, setNumBookmarks] = useState(null);

  useEffect(() => {
    setNumBookmarks(null);
    if (!eventId) return;

    async function fetchInitial() {
      const initialCount = await fetchBookmarkStats(eventId).bookmark_count;
      setNumBookmarks(initialCount);
    }
    fetchInitial();

    function onUpdateBookmark(bookmark) {
      console.log("[Socket.IO] update count on bookmark:updated", bookmark.count);
      if (typeof bookmark.count === "number") setNumBookmarks(bookmark.count);
    }

    socket.on("bookmark:updated", onUpdateBookmark);

    return () => {
      socket.off("bookmark:updated", onUpdateBookmark);
    };
  }, [eventId]);

  return numBookmarks;
}
