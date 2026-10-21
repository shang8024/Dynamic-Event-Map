// Import snapshots are internal reconciliation data, not part of the website's
// event contract. A projection also avoids sending duplicate occurrence arrays.
const FIELDS = ['id','user_id','title','description','category','source','status','starts_at','ends_at',
  'latitude','longitude','location_address','location_name','version','archived_at',
  'author_name','bookmarks_count','next_start','created_at','updated_at'];
const DATA_FIELDS = ['image','imported_image','image_hidden','place_id','website',
  'editor_overrides','schedule_format','schedule_origin'];

function pick(value, fields) {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}
function occurrence(value) { return pick(value, ['key','starts_at','ends_at']); }
function publicEvent(row) {
  const result = pick(row, FIELDS);
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  result.data = pick(data, DATA_FIELDS);
  const ranges = Array.isArray(row.occurrences) ? row.occurrences : data.occurrences;
  if (Array.isArray(ranges)) result.occurrences = ranges.map(occurrence);
  if (row.next_occurrence) result.next_occurrence = occurrence(row.next_occurrence);
  return result;
}
module.exports = { publicEvent };
