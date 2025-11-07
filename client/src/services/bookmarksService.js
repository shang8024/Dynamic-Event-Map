import { API_BASE, get, post, del } from "./apiService.js";
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

export function getCurrentUser() {
  const { user } = useAuth();
  if (user) {
    return { name: user.displayName || user.email };
  }
  // Client-side mock user while auth is not implemented
  return { id: '1', name: 'mockuser' };
}
