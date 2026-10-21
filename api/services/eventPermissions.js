function canManageEvent(user, event) {
  return Boolean(user && event && (user.role === 'admin' || String(user.id) === String(event.user_id)));
}

function validateEvent(input, existing) {
  const value = { ...existing, ...input };
  for (const field of ['title','description','location_address']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) return `${field.replaceAll('_',' ')} is required`;
  }
  if (value.title.length > 255 || value.description.length > 20000 || value.location_address.length > 2000) return 'An event field is too long';
  for (const [field, max] of [['latitude',90],['longitude',180]]) {
    if (value[field] === '' || value[field] == null || !Number.isFinite(Number(value[field])) || Math.abs(Number(value[field])) > max) {
      // Existing source events without coordinates can still be edited.
      if (!(existing && value[field] == null)) return 'A valid location is required';
    }
  }
  for (const field of ['starts_at','ends_at']) {
    const raw = value[field];
    if (!raw && field === 'ends_at' && existing?.source === 'external') continue;
    if (!(raw instanceof Date) && (typeof raw !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(raw))) return 'Dates must include a timezone';
    if (!Number.isFinite(new Date(raw).getTime())) return 'Valid start and end times are required';
  }
  if (value.ends_at && new Date(value.ends_at) < new Date(value.starts_at)) return 'End time must be after start time';
  if (value.status && !['scheduled','cancelled'].includes(value.status)) return 'Invalid event status';
  if (value.place_id && (typeof value.place_id !== 'string' || value.place_id.length > 255)) return 'Invalid place';
  return null;
}
module.exports = { canManageEvent, validateEvent };
