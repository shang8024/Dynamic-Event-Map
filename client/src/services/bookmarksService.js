import { API_BASE, post, del, get } from "./apiService.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export async function fetchBookmarks() {
  const result = await get(`/bookmarks`);
  return { items: result };
}

export async function addBookmark(eventId) {
  return post(`/bookmarks/${eventId}`, {});
}

export async function removeBookmark(bookmarkId) {
  return del(`/bookmarks/${bookmarkId}`);
}

export async function fetchTodaysBookmarks() {
  const result = await get(`/bookmarks/today`);
  return result;
}

export async function fetchBookmarkStats(eventId) {
  const result = await get(`/bookmarks/stats/${eventId}`);
  return result;
}

export function useCurrentUser() {
  const { user } = useAuth();
  if (user) {
    return { name: user.displayName || user.email };
  }
}
