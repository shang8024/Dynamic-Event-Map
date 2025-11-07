import { API_BASE, get, post, del } from "./apiService.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export async function fetchComments(eventId) {
  return get(`/events/${eventId}/comments`);
}

export async function addComment(eventId, text, userId) {
  return post(`/events/${eventId}/comments`, { text, userId });
}

export async function removeComment(eventId, commentId) {
  return del(`/events/${eventId}/comments/${commentId}`);
}

export function getCurrentUser() {
  const { user } = useAuth();
  if (user) {
    return { name: user.displayName || user.email };
  }
  // Client-side mock user while auth is not implemented
  return { id: '1', name: 'mockuser' };
}
