// api/controllers/externalEventsController.js

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
  "$orderby=calendar_date_group,featured_event desc,calendar_date",
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

const getTorontoEvents = async (req, res) => {
  try {
    const from = req.query.from ?? new Date().toISOString().slice(0, 10);
    const to = req.query.to ?? (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    })();
    const url = getTorontoEventsURL({ from, to });
    const data = await fetch(url);
    if (!data.ok) {
      throw new Error(`toronto fetch failed: ${data.status} ${data.statusText}`);
    }
    const dataJson = await data.json();
    const raw = Array.isArray(dataJson?.value) ? dataJson.value : [];
    const events = raw.map(normalizeTorontoEvents);
    return res.json(events);
  } catch (err) {
    console.error("external fetch failed", err);
    return res.status(500).json({ error: "external fetch failed" });
  }
};

module.exports = {
    getTorontoEvents,
};
