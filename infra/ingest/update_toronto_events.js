import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { createClient } from 'redis';
import { METADATA_URL } from './normalize.js';
import { importEvents } from './database.js';
import { readSourceStream, SOURCE_LIMITS } from './stream-source.js';
import { resourceDownloadURL, shouldRetryRevision } from './resource-url.js';
import { withSpooledDownload } from './spool-download.js';

const { values } = parseArgs({ options: {
  input: { type: 'string' }, manifest: { type: 'string' }, output: { type: 'string' },
  'as-of': { type: 'string', default: new Date().toISOString() },
  write: { type: 'boolean', default: false },
} });
const TRUSTED_HOST = 'ckan0.cf.opendata.inter.prod-toronto.ca';

async function fetchOfficial(url, maxBytes, timeoutMs = 30000) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== TRUSTED_HOST) throw new Error('Unexpected official source URL');
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { 'User-Agent': 'Dynamic-Event-Map/3 (Toronto Open Data importer)' } });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`Official source HTTP ${response.status}`), { status: response.status, sourceURL: parsed.href });
  }
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Official source exceeds size limit'); }
  return response;
}

function validateMetadata(metadata) {
  const sourceURL = new URL(metadata.source_url);
  if (sourceURL.protocol !== 'https:' || sourceURL.hostname !== TRUSTED_HOST) throw new Error('Snapshot source is not the official catalogue');
  // CKAN timestamps have no suffix; CKAN metadata is recorded in UTC.
  const modified = Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(metadata.source_last_modified) ? metadata.source_last_modified : `${metadata.source_last_modified}Z`);
  const ageHours = (Date.parse(values['as-of']) - modified) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours > 72 || ageHours < -24) throw new Error('Official source metadata is missing, stale (>72h), or future-dated; review before import');
}

async function fetchCatalogue() {
  const maxBytes = 1024 * 1024;
  const response = await fetchOfficial(METADATA_URL, maxBytes);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Official catalogue exceeds size limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks));
}

async function sourceSnapshot() {
  if (values.input) {
    if (!values.manifest) throw new Error('--input requires --manifest with source URL, timestamp and SHA-256');
    if ((await fs.stat(values.manifest)).size > 1024 * 1024) throw new Error('Snapshot manifest exceeds size limit');
    const metadata = JSON.parse(await fs.readFile(values.manifest, 'utf8'));
    validateMetadata(metadata);
    if (!/^[a-f0-9]{64}$/i.test(metadata.sha256)) throw new Error('Snapshot manifest requires a SHA-256 checksum');
    if ((await fs.stat(values.input)).size > SOURCE_LIMITS.maxBytes) throw new Error('Official source exceeds size limit');
    const streamed = await readSourceStream(createReadStream(values.input), {
      asOf: values['as-of'], expectedSha256: metadata.sha256.toLowerCase(), expectedBytes: metadata.bytes,
    });
    return streamed.finish(metadata);
  }

  let lastError;
  let retryRevision = false;
  let originalResourceURL;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const catalogue = await fetchCatalogue();
      if (!catalogue.success) throw new Error('Official CKAN catalogue returned failure');
      const resource = catalogue.result.resources.find(resource => resource.id === '8900fdb2-7f6c-4f50-8581-b463311ff05d' && resource.format === 'JSON');
      if (!resource) throw new Error('Official JSON resource changed; review schema before proceeding');
      const metadata = { source_url: resource.url, resource_id: resource.id, source_last_modified: resource.last_modified };
      validateMetadata(metadata);
      originalResourceURL = resourceDownloadURL(resource);
      const fetchURL = resourceDownloadURL(resource, retryRevision);
      // Drain to bounded disk first; parsing on a shared .75-CPU VM must not
      // backpressure the official CDN into closing its network connection.
      const response = await fetchOfficial(fetchURL, SOURCE_LIMITS.maxBytes, 300000);
      return await withSpooledDownload(Readable.fromWeb(response.body), async (file, downloaded) => {
        const downloadedAt = new Date().toISOString();
        const streamed = await readSourceStream(createReadStream(file), {
          asOf: values['as-of'], expectedBytes: downloaded.bytes, expectedSha256: downloaded.sha256,
        });
        return streamed.finish({ ...metadata, ...(fetchURL !== originalResourceURL ? { fetch_url: fetchURL } : {}),
          downloaded_at: downloadedAt, bytes: streamed.bytes, sha256: streamed.sha256 });
      }, {
        maxBytes: SOURCE_LIMITS.maxBytes, expectedBytes: Number.isSafeInteger(resource.size) ? resource.size : undefined,
      });
    } catch (error) {
      lastError = error;
      // A stale CDN error was observed from AWS while the same official revision
      // succeeded locally. Retry only 502/503/504 on the identical trusted path
      // with a metadata-revision query; no third-party mirror or host fallback.
      if (shouldRetryRevision(error, originalResourceURL)) retryRevision = true;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function readSecret(path) {
  if (!path) return undefined;
  try { return (await fs.readFile(path, 'utf8')).trim(); } catch (error) { if (error.code !== 'ENOENT') throw error; return undefined; }
}

async function invalidateCache() {
  if (!process.env.REDIS_HOST) return { status: 'not_configured' };
  const password = await readSecret(process.env.REDIS_PASSWORD_FILE || '/run/secrets/redis_password') || process.env.REDISPASSWORD || process.env.REDIS_PASSWORD;
  const client = createClient({ socket: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379), connectTimeout: 5000, reconnectStrategy: false }, password });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.del('eventCount');
    let count = 0;
    for await (const key of client.scanIterator({ MATCH: 'events:summary:*', COUNT: 100 })) { await client.del(key); count++; }
    return { status: 'invalidated', summary_keys: count };
  } finally { if (client.isOpen) await client.quit(); }
}

async function main() {
  const snapshot = await sourceSnapshot();
  if (values.output) await fs.writeFile(values.output, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(JSON.stringify({ mode: values.write ? 'write' : 'dry_run', as_of: snapshot.as_of, provenance: snapshot.provenance, report: snapshot.report, max_rss_kib: process.resourceUsage().maxRSS }, null, 2));
  if (!values.write) return;
  if (!process.env.PGHOST && !process.env.DB_HOST) throw new Error('Explicit PGHOST or DB_HOST is required for --write');
  const password = await readSecret(process.env.PGPASSWORD_FILE || '/run/secrets/pg_password') || process.env.PGPASSWORD || process.env.DB_PASSWORD;
  const client = new pg.Client({
    host: process.env.PGHOST || process.env.DB_HOST,
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    database: process.env.PGDATABASE || process.env.DB_NAME || 'eventsdb',
    user: process.env.PGUSER || process.env.DB_USER,
    password, connectionTimeoutMillis: 10000,
    // pg also honors PGSSLMODE and PGSSLROOTCERT; use verify-full for managed DBs.
  });
  await client.connect();
  try { console.log(JSON.stringify({ database: await importEvents(client, snapshot) })); }
  finally { await client.end(); }
  console.log(JSON.stringify({ cache: await invalidateCache() }));
}

main().catch(error => {
  const causeCode = /^[A-Z0-9_]{1,64}$/.test(error.cause?.code || '') ? ` (${error.cause.code})` : '';
  console.error('[ingest] failed:', error.message + causeCode);
  process.exitCode = 1;
});
