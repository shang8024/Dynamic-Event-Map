import { get, post, del, put } from "./apiService.js";

export async function fetchEvents() {
  return get("/events");
}

export async function createEvent(payload) {
  return post('/events', payload);
}

export async function deleteEvent(id) {
  return del(`/events/${id}`);
}

export async function updateEvent(id, payload) {
  return put(`/events/${id}`, payload);
}
export async function fetchTodaySummary() {
  return get("/stats/today");
}
