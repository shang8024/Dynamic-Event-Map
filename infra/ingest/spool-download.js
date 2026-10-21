import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function withSpooledDownload(source, consume, options) {
  try { return await spoolDownload(source, consume, options); }
  finally { source.destroy(); }
}

async function spoolDownload(source, consume, { maxBytes = 400 * 1024 * 1024, expectedBytes,
  baseDirectory = process.env.INGEST_SPOOL_DIR || os.tmpdir() } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || (expectedBytes !== undefined &&
    (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes))) throw new Error('Invalid bounded download size');
  const base = path.resolve(baseDirectory);
  const disk = await fs.statfs(base);
  // A RAM-backed /tmp would consume the small container's memory allowance.
  if (process.platform === 'linux' && Number(disk.type) === 0x01021994) throw new Error('INGEST_SPOOL_DIR must be disk-backed, not tmpfs');
  const required = (expectedBytes ?? maxBytes) + 16 * 1024 * 1024;
  if (Number(disk.bavail) * Number(disk.bsize) < required) throw new Error('Insufficient disk space for the bounded official snapshot');
  const directory = await fs.mkdtemp(path.join(base, 'eventmap-ingest-'));
  const file = path.join(directory, 'source.json');
  let bytes = 0;
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(new Error('Official source exceeds size limit'));
    hash.update(chunk); callback(null, chunk);
  } });
  try {
    await fs.chmod(directory, 0o700);
    // Drain the network promptly; CPU-heavy parsing happens after download so
    // parser backpressure cannot keep the source/CDN connection open for minutes.
    await pipeline(source, meter, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    if (expectedBytes !== undefined && bytes !== expectedBytes) throw new Error('Official source length validation failed');
    return await consume(file, { bytes, sha256: hash.digest('hex') });
  } finally {
    // Only this invocation's file and empty generated directory are removed.
    // No recursive cleanup or scan of another run's directory is performed.
    await fs.rm(file, { force: true });
    await fs.rmdir(directory);
  }
}
