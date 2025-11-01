import { API_BASE, get, post, del } from "./apiService.js";
export async function fetchComments(eventId) {
  return get(`/events/${eventId}/comments`);
}

export async function addComment(eventId, text) {
  return post(`/events/${eventId}/comments`, { text });
}

export async function removeComment(eventId, commentId) {
  return del(`/events/${eventId}/comments/${commentId}`);
}

export function getCurrentUser() {
  // Client-side mock user while auth is not implemented
  return { id: '1', name: 'mockuser' };
}
