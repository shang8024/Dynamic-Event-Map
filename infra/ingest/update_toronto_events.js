import pg from "pg";
import fs from "node:fs";
const { Client } = pg;

const TORONTO_BASE =
  "https://secure.toronto.ca/c3api_data/v2/DataAccess.svc/festivals_events/events";
const calendars = [
    "a4f795ff-e94f-46bd-a1c3-c94ec1549567",
    "adb9c00b-5f61-4a01-90b5-6cf00d00faf0",
    "ad38461b-1274-4afe-ae3a-320fba6b28b0",
    "4b1fdab9-7e0c-4dea-91d5-ae5cae097cb3",
    "7650a094-e8de-4212-9188-9d82e33b17b6",
    "66ac8918-922b-4eff-98db-7784bf842523",
    "ee486807-a5e6-44fd-8c98-496caaca50a1",
    "5ec2e57f-03d6-499b-b46c-8f0babf97e0a",
    "4a75ca32-c2b0-4baa-a0ee-703cd9e53b03",
    "1550cde5-f772-4772-a7bb-572344640f23",
    "ae3fcc96-e2eb-4522-95bd-5ba198ccf6de",
    "2603f051-0d4d-48db-95f0-b3061b210efd",
    "3197d23d-c257-4584-89b2-b100f99ce6d4",
    "da506e92-d63c-43fa-864a-78a53b52f706",
    "82f36b6c-101e-41a9-81c5-1434d7ae673b",
  ];
const calExpr = calendars.map(
    (id) => `calendar_id eq '${id}'`,
  ).join(' or ');
function toTorontoIso(isoDate) {
  return `${isoDate}T00:00:00-04:00`;
}

function getTorontoEventsURL({ from, to }) {
  const qs = [
  "$format=application/json;odata.metadata=none",
  "$skip=0",
  "$top=5000",
  "$select=" + [
    "id",
    "short_name",
    "short_description",
    "event_image",
    "event_locations",
    "featured_event",
    "free_event",
    "event_startdate",
    "event_enddate",
    "calendar_date",
    "calendar_date_group"
  ].join(","),
  "$orderby=calendar_date_group asc, event_startdate asc",
  `$filter=(${calExpr}) and calendar_date ge ${toTorontoIso(from)} and calendar_date lt ${toTorontoIso(to)}`
].join("&");
  const url = `${TORONTO_BASE}?${qs}`;
  return url;
}

function normalizeTorontoEvents(raw) {
  const loc = Array.isArray(raw.event_locations) && raw.event_locations.length > 0
    ? raw.event_locations[0]
    : null;

  let lat = null;
  let lng = null;
  if (loc && loc.location_gps) {
    try {
      const arr = JSON.parse(loc.location_gps);
      if (Array.isArray(arr) && arr[0]) {
        lat = arr[0].gps_lat ?? null;
        lng = arr[0].gps_lng ?? null;
      }
    } catch (_) {
      // ignore
    }
  }

  let event_image = null;
  if (Array.isArray(raw.event_image) && raw.event_image.length > 0) {
    const img = raw.event_image[0];
    event_image = {
      alt: img.fields?.alt || null,
      url: img.bin_id ? `https://secure.toronto.ca/c3api_upload/retrieve/festivals_events/${img.bin_id}` : null,
    };
  }

  const startsAt = raw.event_startdate || raw.calendar_date || null;
  const endsAt = raw.event_enddate || null;
  return {
    source: "external",
    external_id: String(raw.id),
    title: raw.short_name || "Untitled",
    description: raw.short_description || null,
    starts_at: startsAt ? new Date(startsAt).toISOString() : null,
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    latitude: lat,
    longitude: lng,
    location_name: loc ? loc.location_name : null,
    location_address: loc ? loc.location_address : null,
    data: {
      featured: raw.featured_event === "Yes",
      free: raw.free_event === "Yes",
      image: event_image,
      raw,
    },
  };
}

function readSecret(path) {
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

async function main() {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const d2 = new Date();
  d2.setDate(d2.getDate() + 30);
  const to = d2.toISOString().slice(0, 10);

  const url = getTorontoEventsURL({ from, to });
  console.log("[pull] fetch:", url);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();

  const rawArr = Array.isArray(json?.value) ? json.value : [];
  console.log(`[pull] got ${rawArr.length} events`);

  const events = rawArr.map(normalizeTorontoEvents);
  const secretPass =
    readSecret("/run/secrets/pg_password") ||
    process.env.PGPASSWORD ||
    process.env.DB_PASSWORD ||
    undefined;

  const client = new Client({
    host: process.env.PGHOST || process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    database: process.env.PGDATABASE || process.env.DB_NAME || "eventsdb",
    user: process.env.PGUSER || process.env.DB_USER || "user",
    password: secretPass,
  });
  await client.connect();

  const upsertSQL = `
    INSERT INTO events (
      title, source, ref_id, description,
      data, starts_at, ends_at, latitude, longitude,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9,
      NOW()
    )
    ON CONFLICT (source, ref_id)
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      data = EXCLUDED.data,
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      updated_at = NOW();
  `;

  let ok = 0,
    fail = 0;
  for (const ev of events) {
    try {
      await client.query(upsertSQL, [
        ev.title,
        ev.source,
        ev.ref_id,
        ev.description,
        ev.data,
        ev.starts_at,
        ev.ends_at,
        ev.latitude,
        ev.longitude,
      ]);
      ok++;
    } catch (e) {
      fail++;
      console.error("upsert failed:", e.message);
    }
  }

  await client.end();
  console.log(`[pull] done. upserted=${ok}, failed=${fail}`);
  await client.query(
    `
    DELETE FROM events e
    WHERE e.source = 'external'
      AND e.ends_at IS NOT NULL
      AND e.ends_at < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM bookmarks b
        WHERE b.external_source = 'external'
          AND b.external_ref_id = e.ref_id
      );
    `
  );
  await client.end();
  console.log("[pull] done.");
}

main().catch((err) => {
  console.error("[pull] fatal:", err);
  process.exit(1);
});