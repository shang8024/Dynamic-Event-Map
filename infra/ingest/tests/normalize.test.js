import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeed, instant } from '../normalize.js';

const asOf = '2026-10-21T12:00:00-04:00';
const row = (overrides = {}) => ({
  id: 'row-1', submission_id: 'series-1', event_name: 'Community exhibition',
  event_status: 'Approved', __ModifiedOn: '2026-10-20T12:00:00-04:00',
  calendar_date: '2026-11-01T09:00:00-05:00',
  event_startdate: '2026-10-01T09:00:00-04:00',
  event_enddate: '2026-11-01T09:00:00-05:00',
  event_expirydate: '2026-11-01T17:00:00-05:00',
  event_category: ['Arts/Exhibits'],
  event_locations: [{ location_name: 'Gallery', location_address: 'Toronto', location_gps: '[{"gps_lat":43.65,"gps_lng":-79.38}]' }],
  event_email: 'organizer@example.invalid', event_telephone: '555-0100',
  ...overrides,
});
const normalize = (rows) => normalizeFeed({ value: rows }, { asOf, provenance: { source_url: 'official', sha256: 'abc' } });

test('uses source offsets across DST and rejects ambiguous local time', () => {
  assert.equal(instant('2026-10-31T09:00:00-04:00'), '2026-10-31T13:00:00.000Z');
  assert.equal(instant('2026-11-01T09:00:00-05:00'), '2026-11-01T14:00:00.000Z');
  assert.equal(instant('2026-11-01T01:30:00'), null);
});
test('deduplicates series while preserving occurrence starts and final actual end', () => {
  const { events } = normalize([row(), row({ id: 'row-2', calendar_date: '2026-10-31T09:00:00-04:00' })]);
  assert.equal(events.length, 1);
  assert.equal(events[0].ref_id, 'toronto:series-1');
  assert.equal(events[0].ends_at, '2026-11-01T22:00:00.000Z');
  assert.deepEqual(events[0].data.occurrences.map(o => o.starts_at), ['2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z']);
});
test('preserves ongoing series, rejects ended series, keeps far-future official events', () => {
  const result = normalize([row(), row({ submission_id: 'ended', event_expirydate: '2026-10-20T17:00:00-04:00' }), row({ submission_id: 'future', event_startdate: '2027-12-01T09:00:00-05:00', event_expirydate: '2027-12-01T17:00:00-05:00' })]);
  assert.equal(result.events.length, 2);
  assert.equal(result.report.ended_series, 1);
  assert.equal(result.report.beyond_one_year, 1);
});
test('does not guess an end time or retain already-started events without a known end', () => {
  const result = normalize([row(), row({ submission_id: 'unknown-past', event_expirydate: null }), row({ submission_id: 'unknown-future', event_startdate: '2026-11-01T09:00:00-05:00', event_expirydate: null })]);
  assert.equal(result.events.length, 2);
  assert.equal(result.events.find(e => e.ref_id === 'toronto:unknown-future').ends_at, null);
  assert.equal(result.report.missing_end_series, 2);
});
test('removes organizer contact fields and invalid coordinates without inventing a location', () => {
  const result = normalize([row({ event_locations: [{ location_gps: '[{"gps_lat":999,"gps_lng":""}]' }] })]);
  const event = result.events[0];
  assert.equal(event.latitude, null); assert.equal(event.longitude, null);
  assert.equal(JSON.stringify(event).includes('organizer@example.invalid'), false);
  assert.equal(JSON.stringify(event).includes('555-0100'), false);
});
test('fails closed on empty data or malformed schema', () => {
  assert.throws(() => normalize([]), /empty/);
  assert.throws(() => normalize([{ title: 'changed schema' }]), /schema changed/);
});
test('quarantines invalid ranges while leaving valid events importable', () => {
  const result = normalize([row(), row({ submission_id: 'invalid', event_expirydate: '2026-01-01T00:00:00Z' })]);
  assert.equal(result.events.length, 1); assert.equal(result.report.rejected_series, 1);
});
test('new upstream revision updates hash while fetch metadata alone does not', () => {
  const first = normalize([row()]).events[0];
  const second = normalizeFeed({ value: [row()] }, { asOf, provenance: { downloaded_at: 'later' } }).events[0];
  assert.equal(first.data.import_snapshot.content_hash, second.data.import_snapshot.content_hash);
  const changed = normalize([row({ event_name: 'New title' })]).events[0];
  assert.notEqual(first.data.import_snapshot.content_hash, changed.data.import_snapshot.content_hash);
});
