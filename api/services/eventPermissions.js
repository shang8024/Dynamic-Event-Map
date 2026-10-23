function canManageEvent(user, event) {
  return Boolean(user && event && (user.role === 'admin' || String(user.id) === String(event.user_id)));
}

function validateEventSubmission(input) {
  if (!['organizer','reporter'].includes(input.submission_role)) return 'Choose whether you are an organizer or are sharing an event.';
  if (Object.hasOwn(input,'organizer_confirmed') && typeof input.organizer_confirmed !== 'boolean') return 'Organizer confirmation must be a checkbox value.';
  if (input.submission_role === 'organizer' && input.organizer_confirmed !== true) return 'Confirm that you are the organizer or are authorized to publish on their behalf.';
  return null;
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
  const locationChanged=!existing || ['latitude','longitude'].some(field=>Object.hasOwn(input,field)&&String(input[field]??'')!==String(existing[field]??''));
  if(locationChanged && value.latitude!=null && value.longitude!=null &&
    (Number(value.latitude)<43.3||Number(value.latitude)>44.55||Number(value.longitude)<-80.2||Number(value.longitude)>-78.3)) return 'The event location must be within the GTA.';
  for (const field of ['starts_at','ends_at']) {
    const raw = value[field];
    if (!raw && field === 'ends_at') continue;
    if (!(raw instanceof Date) && (typeof raw !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(raw))) return 'Dates must include a timezone';
    if (!Number.isFinite(new Date(raw).getTime())) return 'Valid start and end times are required';
  }
  if (value.ends_at && new Date(value.ends_at) < new Date(value.starts_at)) return 'End time must be after start time';
  if (value.status && !['scheduled','cancelled'].includes(value.status)) return 'Invalid event status';
  if (value.place_id && (typeof value.place_id !== 'string' || value.place_id.length > 255)) return 'Invalid place';
  if (Object.hasOwn(input,'organizer_name') && (typeof input.organizer_name !== 'string' || input.organizer_name.length > 255)) return 'Organizer name must be 255 characters or fewer.';
  return null;
}
module.exports = { canManageEvent, validateEvent, validateEventSubmission };
