import { API_BASE, get, post, del, put } from "./apiService.js";

export async function fetchEvents() {
  return get("/events");
}

export async function createEvent({
  title,
  description,
  category,
  latitude,
  longitude,
  location_address,
  starts_at,
  ends_at,
}) {
  return post("/events", {
    title,
    description,
    category,
    latitude,
    longitude,
    location_address,
    starts_at,
    ends_at,
  });
}

export async function deleteEvent(id) {
  return del(`/events/${id}`);
}

export async function updateEvent(id, payload) {
  return put(`/events/${id}`, payload);
}
