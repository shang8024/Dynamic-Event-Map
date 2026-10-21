import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readSourceStream } from '../stream-source.js';
import { createFeedNormalizer, normalizeFeed } from '../normalize.js';

const asOf = '2026-10-21T15:39:00Z';
const provenance = { source_url: 'https://example.invalid/source', sha256: 'test' };
const row = (overrides = {}) => ({
  id: 'row-one', submission_id: 'series-one', event_name: 'Café 🎭 中文',
  event_status: 'Approved', __ModifiedOn: '2026-10-20T12:00:00-04:00',
  event_startdate: '2026-11-01T09:00:00-05:00', event_expirydate: '2026-11-02T17:00:00-05:00',
  calendar_date: '2026-11-01T09:00:00-05:00', event_description: 'A community event',
  event_locations: [{ location_gps: '[{"gps_lat":43.65,"gps_lng":-79.38}]' }],
  ...overrides,
});
function bytesOf(value) { return Buffer.from(JSON.stringify(value)); }
function input(bytes, chunkSize = 64) {
  return Readable.from((function* () {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
  })());
}

test('streaming handles split UTF-8 and preserves the reviewed normalization', async () => {
  const feed = { metadata: 'ignored', value: [row(), row({ id: 'row-two', calendar_date: '2026-11-02T09:00:00-05:00', event_dates: [{ date: 123, extra: 'discard me' }] })] };
  const bytes = bytesOf(feed);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const streamed = await readSourceStream(input(bytes, 1), { asOf, expectedBytes: bytes.length, expectedSha256: sha256 });
  assert.equal(streamed.bytes, bytes.length); assert.equal(streamed.sha256, sha256);
  assert.deepEqual(streamed.finish(provenance), normalizeFeed(feed, { asOf, provenance }));
});

test('latest source revision wins while every distinct occurrence remains', async () => {
  const feed = { value: [row(), row({ id: 'row-two', __ModifiedOn: '2026-10-21T10:00:00-04:00', event_name: 'Updated title', calendar_date: '2026-11-02T09:00:00-05:00' }), row({ id: 'row-three', event_name: 'Old title' })] };
  const stream = await readSourceStream(input(bytesOf(feed)), { asOf });
  const event = stream.finish(provenance).events[0];
  assert.equal(event.title, 'Updated title');
  assert.equal(event.data.occurrences.length, 2);
});

test('truncated or malformed input never produces a completed snapshot', async () => {
  const truncated = Buffer.from(`{"value":[${JSON.stringify(row())},`);
  await assert.rejects(() => readSourceStream(input(truncated), { asOf }), /Parser/);
  await assert.rejects(() => readSourceStream(input(bytesOf({ value: {} })), { asOf }), /array/);
  const missing = await readSourceStream(input(bytesOf({ wrong: [row()] })), { asOf });
  assert.throws(() => missing.finish(provenance), /empty/);
});

test('checksum and length mismatches reject a fully parsed source', async () => {
  const bytes = bytesOf({ value: [row()] });
  await assert.rejects(() => readSourceStream(input(bytes), { asOf, expectedSha256: '0'.repeat(64) }), /checksum/);
  await assert.rejects(() => readSourceStream(input(bytes), { asOf, expectedBytes: bytes.length + 1 }), /size/);
});

test('byte, nesting, field and record bounds fail closed', async () => {
  const bytes = bytesOf({ value: [row()] });
  await assert.rejects(() => readSourceStream(input(bytes), { asOf, limits: { maxBytes: 30 } }), /size limit/);
  await assert.rejects(() => readSourceStream(input(bytes), { asOf, limits: { maxDepth: 2 } }), /nesting/);
  await assert.rejects(() => readSourceStream(input(bytes), { asOf, limits: { maxStringBytes: 5 } }), /field/);
  await assert.rejects(() => readSourceStream(input(bytes), { asOf, limits: { maxRecordTokens: 5 } }), /record/);
  await assert.rejects(() => readSourceStream(input(bytes), { asOf, limits: { maxRecordBytes: 10 } }), /record/);
});

test('retained series and row bounds stop unbounded aggregation', () => {
  const rows = createFeedNormalizer({ asOf, limits: { maxRows: 1 } });
  rows.addRow(row()); assert.throws(() => rows.addRow(row()), /row count/);
  const series = createFeedNormalizer({ asOf, limits: { maxSeries: 1 } });
  series.addRow(row()); assert.throws(() => series.addRow(row({ submission_id: 'second' })), /series count/);
  const retained = createFeedNormalizer({ asOf, limits: { maxRetainedBytes: 1 } });
  assert.throws(() => retained.addRow(row()), /Compacted/);
});
