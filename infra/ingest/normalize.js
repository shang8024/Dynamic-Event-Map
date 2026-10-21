import { createHash } from 'node:crypto';

export const PROVIDER = 'toronto-open-data';
export const CATALOGUE_URL = 'https://open.toronto.ca/dataset/festivals-events/';
export const METADATA_URL = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=festivals-events';
export const LICENCE_URL = 'https://open.toronto.ca/open-data-licence/';
export const ATTRIBUTION = 'Contains information licensed under the Open Government Licence – Toronto.';
export const FIELDS = ['title', 'description', 'category', 'starts_at', 'ends_at', 'latitude', 'longitude', 'location_name', 'location_address'];

export function instant(value) {
  // The source supplies a UTC offset, including Toronto daylight-saving changes.
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function coordinate(value, max) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

function location(raw) {
  let gps;
  try { gps = JSON.parse(raw.location_gps || '[]')[0]; } catch { /* no invented coordinates */ }
  return {
    name: raw.location_name || null,
    address: raw.location_address || null,
    latitude: coordinate(gps?.gps_lat ?? raw.geo_lat, 90),
    longitude: coordinate(gps?.gps_lng ?? raw.geo_long, 180),
  };
}

function category(categories = []) {
  const names = categories.join(' ').toLowerCase();
  if (/sport|fitness/.test(names)) return 'Sports & Fitness';
  if (/food|culinary/.test(names)) return 'Food & Drink';
  if (/workshop|education/.test(names)) return 'Education & Workshops';
  if (/family|children/.test(names)) return 'Family & Kids';
  if (/music|performance|film|entertainment/.test(names)) return 'Entertainment & Leisure';
  if (/art|exhibit|culture|cultural|heritage/.test(names)) return 'Arts & Culture';
  if (/community|charity/.test(names)) return 'Community & Social';
  if (/business/.test(names)) return 'Business & Networking';
  return 'Other';
}

export const DEFAULT_AGGREGATION_LIMITS = Object.freeze({ maxRows: 100000, maxSeries: 20000, maxRetainedBytes: 48 * 1024 * 1024 });

function projectRow(raw) {
  // Do not retain repeated event_dates, location_dates, contacts, images, or raw
  // rows. Only one compact latest revision and occurrence starts per series stay
  // in memory while the source is streamed.
  const fields = ['event_startdate', 'event_expirydate', 'event_name', 'short_name',
    'event_status', 'event_description', 'short_description', 'event_category',
    'featured_event', 'free_event', 'event_website', '__ModifiedOn'];
  const projected = Object.fromEntries(fields.map(field => [field, raw[field]]));
  projected.locations = (Array.isArray(raw.event_locations) ? raw.event_locations : []).map(location);
  return projected;
}

export function createFeedNormalizer({ asOf, limits = {} }) {
  const cutoff = instant(asOf);
  if (!cutoff) throw new Error('asOf must be an ISO timestamp with an explicit UTC offset');
  const bounds = { ...DEFAULT_AGGREGATION_LIMITS, ...limits };
  const groups = new Map();
  let retainedBytes = 0;
  let finished = false;
  const report = { raw_rows: 0, series: 0, active_series: 0, ended_series: 0, rejected_series: 0, missing_end_series: 0, multi_location_series: 0, missing_coordinates: 0, beyond_one_year: 0, rejected: [] };

  function addRow(raw) {
    if (finished) throw new Error('Cannot append to a completed source snapshot');
    if (++report.raw_rows > bounds.maxRows) throw new Error('Source row count exceeds the reviewed memory limit');
    if (!raw || typeof raw.id !== 'string' || !raw.id) throw new Error('Source schema changed: missing row id');
    const key = raw.submission_id || raw.id;
    if (typeof key !== 'string' || key.length > 80) throw new Error('Invalid source identity');
    let group = groups.get(key);
    const revisionMs = Date.parse(instant(raw.__ModifiedOn)) || 0;
    if (!group) {
      if (groups.size >= bounds.maxSeries) throw new Error('Source series count exceeds the reviewed memory limit');
      group = { raw: null, revisionMs: -1, bytes: 0, occurrences: new Map() };
      // The tokenizer may return string slices backed by an entire input chunk.
      // Copy retained IDs so a 36-character UUID cannot pin an old raw buffer.
      groups.set(Buffer.from(key).toString('utf8'), group);
    }
    if (revisionMs > group.revisionMs) {
      const projected = projectRow(raw);
      const serialized = JSON.stringify(projected);
      const bytes = Buffer.byteLength(serialized);
      retainedBytes += bytes - group.bytes;
      // Reparse only the small projection to detach all strings from raw chunks.
      group.raw = JSON.parse(serialized); group.bytes = bytes; group.revisionMs = revisionMs;
    }
    const startsAt = instant(raw.calendar_date);
    if (startsAt) {
      const occurrence = { starts_at: startsAt, source_row_id: Buffer.from(raw.id).toString('utf8') };
      const previous = group.occurrences.get(startsAt);
      retainedBytes += Buffer.byteLength(JSON.stringify(occurrence)) - (previous ? Buffer.byteLength(JSON.stringify(previous)) : 0);
      group.occurrences.set(startsAt, occurrence);
    }
    if (retainedBytes > bounds.maxRetainedBytes) throw new Error('Compacted source data exceeds the reviewed memory limit');
  }

  function finish(provenance) {
  if (finished) throw new Error('Source snapshot has already been completed');
  finished = true;
  if (!report.raw_rows) throw new Error('Expected non-empty official {value: [...]} feed; refusing an empty import');
  const events = [];
  report.series = groups.size;
  for (const [identity, group] of groups) {
    const raw = group.raw;
    const startsAt = instant(raw.event_startdate);
    // event_enddate is often the START of the final recurrence, not its end.
    // event_expirydate is the final end; do not fabricate missing ends.
    const endsAt = instant(raw.event_expirydate);
    const title = raw.event_name || raw.short_name;
    if (raw.event_status !== 'Approved' || !startsAt || typeof title !== 'string' || !title.trim() || title.length > 255 || (endsAt && endsAt < startsAt)) {
      report.rejected_series++;
      report.rejected.push({ source_id: identity, reason: 'status, title, or date validation failed' });
      continue;
    }
    if (!endsAt) report.missing_end_series++;
    if ((endsAt && endsAt < cutoff) || (!endsAt && startsAt < cutoff)) {
      report.ended_series++;
      continue;
    }
    const locations = raw.locations;
    const primary = locations.find(l => l.latitude !== null && l.longitude !== null) || locations[0] || {};
    const occurrences = [...group.occurrences.values()].sort((a,b) => a.starts_at.localeCompare(b.starts_at));
    const fields = {
      title,
      description: raw.event_description || raw.short_description || null,
      category: category(Array.isArray(raw.event_category) ? raw.event_category : []),
      starts_at: startsAt,
      ends_at: endsAt,
      latitude: primary.latitude ?? null,
      longitude: primary.longitude ?? null,
      location_name: primary.name || null,
      location_address: primary.address || null,
    };
    const data = {
      featured: raw.featured_event === 'Yes', free: raw.free_event === 'Yes',
      source_url: CATALOGUE_URL,
      website: /^https?:\/\//i.test(raw.event_website || '') ? raw.event_website : null,
      locations, occurrences,
      source_categories: raw.event_category || [],
      attribution: ATTRIBUTION,
      licence_url: LICENCE_URL,
      // Omit organizer emails/phones, photos with separate rights, and raw rows.
      import_metadata: { provider: PROVIDER, source_id: identity, source_modified_at: instant(raw.__ModifiedOn), ...provenance },
    };
    const contentHash = createHash('sha256').update(JSON.stringify({ fields, data: { ...data, import_metadata: { provider: PROVIDER, source_id: identity, source_modified_at: instant(raw.__ModifiedOn) } } })).digest('hex');
    events.push({ source: 'external', ref_id: `toronto:${identity}`, ...fields, data: { ...data, import_snapshot: { ...fields, content_hash: contentHash } } });
    if (locations.length > 1) report.multi_location_series++;
    if (fields.latitude === null || fields.longitude === null) report.missing_coordinates++;
    if (Date.parse(startsAt) > Date.parse(cutoff) + 366 * 86400000) report.beyond_one_year++;
  }
  report.active_series = events.length;
  report.occurrence_starts = events.reduce((sum, event) => sum + event.data.occurrences.length, 0);
  report.future_occurrence_starts = events.reduce((sum, event) => sum + event.data.occurrences.filter(occurrence => occurrence.starts_at >= cutoff).length, 0);
  if (!events.length) throw new Error('No valid non-ended events; refusing an empty import');
  groups.clear();
  return { version: 1, as_of: cutoff, provenance, report, events: events.sort((a,b) => a.ref_id.localeCompare(b.ref_id)) };
  }

  return { addRow, finish };
}

export function normalizeFeed(feed, { asOf, provenance }) {
  if (!Array.isArray(feed?.value)) throw new Error('Expected non-empty official {value: [...]} feed; refusing an empty import');
  const normalizer = createFeedNormalizer({ asOf });
  for (const raw of feed.value) normalizer.addRow(raw);
  return normalizer.finish(provenance);
}
