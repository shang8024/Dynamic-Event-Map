import { API_BASE, get, post, del } from "./apiService.js";

export async function fetchComments(eventId) {
  return get(`/events/${eventId}/comments`);
}

// note: server derives author from the authenticated user (Authorization header)
export async function addComment(eventId, text) {
  return post(`/events/${eventId}/comments`, { text });
}

export async function removeComment(eventId, commentId) {
  return del(`/events/${eventId}/comments/${commentId}`);
}
