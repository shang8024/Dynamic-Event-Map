export function getEventStatus(item) {
  const event = item?.event || item?.eventData;
  if (!event) return null;

  const now = new Date();
  const starts = event.startsAt
    ? new Date(event.startsAt)
    : event._row?.starts_at
      ? new Date(event._row.starts_at)
      : null;
  const ends = event.endsAt
    ? new Date(event.endsAt)
    : event._row?.ends_at
      ? new Date(event._row.ends_at)
      : null;

  if (ends && ends < now) return "Expired";
  if (starts && starts <= now && (!ends || ends >= now)) return "In progress";
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
