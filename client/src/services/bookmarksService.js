import { API_BASE, post, del } from "./apiService.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export async function fetchBookmarks() {
  const result = await post(`/bookmarks`, {});
  return { items: result };
}

export async function addBookmark(eventId) {
  return post(`/bookmarks/${eventId}`, {});
}

export async function removeBookmark(bookmarkId) {
  return del(`/bookmarks/${bookmarkId}`);
}

export function useCurrentUser() {
  const { user } = useAuth();
  if (user) {
    return { name: user.displayName || user.email };
  }
}
