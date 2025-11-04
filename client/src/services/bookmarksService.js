import { API_BASE, get, post, del } from "./apiService.js";
export async function fetchBookmarks() {
  const result = await post(`/bookmarks`, {});
  return { items: result };
}

export async function addBookmark(eventId) {
  return post(`/bookmarks/add`, { eventId });
}

export async function removeBookmark(eventId) {
  return del(`/bookmarks/${eventId}`, {});
}

export function getCurrentUser() {
  // Client-side mock user while auth is not implemented
  return { id: '1', name: 'mockuser' };
}
