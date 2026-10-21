import { createHash } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import { createFeedNormalizer } from './normalize.js';

export const SOURCE_LIMITS = Object.freeze({
  maxBytes: 400 * 1024 * 1024, maxDepth: 32, maxStringBytes: 2 * 1024 * 1024,
  maxKeyBytes: 256, maxNumberBytes: 64, maxRecordTokens: 100000, maxRecordBytes: 8 * 1024 * 1024,
});

function tokenGuard(limits) {
  let depth = 0; let scalarBytes = 0; let scalarLimit = 0;
  return new Transform({ objectMode: true, transform(token, _encoding, callback) {
    try {
      if (token.name === 'startObject' || token.name === 'startArray') {
        if (++depth > limits.maxDepth) throw new Error('Source JSON nesting exceeds the reviewed limit');
      } else if (token.name === 'endObject' || token.name === 'endArray') depth--;
      if (['startString', 'startKey', 'startNumber'].includes(token.name)) {
        scalarBytes = 0;
        scalarLimit = token.name === 'startKey' ? limits.maxKeyBytes : token.name === 'startNumber' ? limits.maxNumberBytes : limits.maxStringBytes;
      } else if (token.name === 'stringChunk' || token.name === 'numberChunk') {
        scalarBytes += Buffer.byteLength(token.value);
        if (scalarBytes > scalarLimit) throw new Error('Source JSON field exceeds the reviewed size limit');
      }
      callback(null, token);
    } catch (error) { callback(error); }
  } });
}

function recordGuard(limits) {
  let depth = 0; let tokens = 0; let bytes = 0;
  return new Transform({ objectMode: true, transform(token, _encoding, callback) {
    try {
      if (depth > 1 && ++tokens > limits.maxRecordTokens) throw new Error('Source record exceeds the reviewed token limit');
      if (depth > 1 && (token.name === 'stringChunk' || token.name === 'numberChunk')) {
        bytes += Buffer.byteLength(token.value);
        if (bytes > limits.maxRecordBytes) throw new Error('Source record exceeds the reviewed size limit');
      }
      if (token.name === 'startObject' || token.name === 'startArray') {
        if (depth === 1) { tokens = 0; bytes = 0; }
        depth++;
      } else if (token.name === 'endObject' || token.name === 'endArray') depth--;
      callback(null, token);
    } catch (error) { callback(error); }
  } });
}

export async function readSourceStream(source, { asOf, expectedSha256, expectedBytes, limits = {}, aggregationLimits } = {}) {
  const bounds = { ...SOURCE_LIMITS, ...limits };
  const normalizer = createFeedNormalizer({ asOf, limits: aggregationLimits });
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > bounds.maxBytes) return callback(new Error('Official source exceeds size limit'));
    hash.update(chunk); callback(null, chunk);
  } });
  const sink = new Writable({ objectMode: true, write({ value }, _encoding, callback) {
    try { normalizer.addRow(value); callback(); } catch (error) { callback(error); }
  } });
  // Streaming strings/keys lets the guard reject oversized fields before the
  // assembler retains a complete row. Packed values are still needed by it.
  await pipeline(source, meter,
    parser.asStream({ packValues: true, streamValues: true }),
    tokenGuard(bounds), pick.asStream({ filter: 'value', maxDepth: bounds.maxDepth }),
    recordGuard(bounds), streamArray.asStream(), sink);
  const sha256 = hash.digest('hex');
  if ((expectedSha256 && sha256 !== expectedSha256) || (expectedBytes !== undefined && bytes !== expectedBytes)) {
    throw new Error('Snapshot checksum or size validation failed');
  }
  // Nothing is normalized into a writable snapshot until the complete stream,
  // JSON structure and optional checksum/length have all passed validation.
  return { bytes, sha256, finish: provenance => normalizer.finish(provenance) };
}
