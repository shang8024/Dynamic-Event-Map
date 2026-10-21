import {eventOccurrences,isEnded,nextOccurrence} from './event.js';
export function getEventStatus(item) {
  const event = item?.event || item?.eventData || item;
  if (!event) return null;

  if ((event.status || event._row?.status) === 'cancelled') return 'Cancelled';
  if(isEnded(event)) return 'Expired';
  if(eventOccurrences(event).length) {
    const next=nextOccurrence(event);
    if(next && Date.parse(next.starts_at)<=Date.now() && next.ends_at && Date.parse(next.ends_at)>Date.now()) return 'In progress';
    return next?null:'Time to confirm';
  }
  const now = new Date();
  const starts = event.startsAt
    ? new Date(event.startsAt)
    : (event.starts_at || event._row?.starts_at)
      ? new Date(event.starts_at || event._row.starts_at)
      : null;
  const ends = event.endsAt
    ? new Date(event.endsAt)
    : (event.ends_at || event._row?.ends_at)
      ? new Date(event.ends_at || event._row.ends_at)
      : null;

  if (ends && ends < now) return "Expired";
  if (starts && starts <= now && ends && ends >= now) return "In progress";
  if (starts && starts <= now && !ends) return 'Time to confirm';
  return null;
}

/**
 * Normalize string for case-insensitive comparison
 * @param {any} s - String to normalize
 * @returns {string} - Lowercase string
 */
export function normalize(s) {
  return (s || "").toString().toLowerCase();
}

/**
 * Format event date display
 * @param {string|Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatEventDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString();
}
