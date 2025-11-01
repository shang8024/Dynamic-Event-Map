import { API_BASE, get, post, del, put } from "./apiService.js";

export async function fetchEvents() {
  return get("/events");
}

export async function createEvent({ title, description, latitude, longitude }) {
  return post("/events", { title, description, latitude, longitude });
}

export async function deleteEvent(id) {
  return del(`/events/${id}`);
}

export async function updateEvent(id, payload) {
  return put(`/events/${id}`, payload);
}
