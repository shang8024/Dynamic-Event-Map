import { get, post, del, put } from "./apiService.js";
import {API_BASE} from './apiService.js';
import {requestJSON} from './apiErrors.js';
import {createMapCatalogueClient} from './mapCatalogue.js';
export const fetchMapEvents=createMapCatalogueClient({base:API_BASE});

export async function fetchEvents() {
  return get("/events");
}

export async function fetchEvent(id,{signal}={}) {
  return requestJSON(`${API_BASE}/events/${id}`,{signal,credentials:'omit'});
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
