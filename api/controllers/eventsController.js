const Event = require("../models/eventModel");
const redisClient = require("../config/redis");
const socket = require("../socket");
const pool = require("../config/db");

const getEvents = async (req, res) => {
  try {
    const result = await Event.getAll();
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
};

const createEvent = async (req, res) => {
  const {
    title,
    description,
    source = "internal",
    latitude: lat,
    longitude: lng,
    location_address,
    starts_at: rawStarts,
    ends_at: rawEnds,
    category = 'Other',
  } = req.body;

  // require minimal fields
  if (
    !title ||
    lat === undefined ||
    lng === undefined ||
    !location_address ||
    !rawStarts ||
    !description ||
    !rawEnds
  ) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  let user_id = null;
  if (String(source) === "external") {
    // use system profile
    try {
      const r = await pool.query(
        "SELECT id FROM profiles WHERE username = 'system' LIMIT 1"
      );
      user_id = r.rows[0]?.id || null;
    } catch (e) {
      console.warn("Unable to resolve system profile", e);
    }
  } else {
    if (!req.user)
      return res.status(401).json({ error: "Authentication required" });
    user_id = req.user.id;
  }

  const starts_at =
    typeof rawStarts === "string" ? new Date(rawStarts) : rawStarts;
  const ends_at = typeof rawEnds === "string" ? new Date(rawEnds) : rawEnds;

  try {
    const result = await Event.create({
      user_id,
      title,
      description,
      category,
      lat,
      lng,
      location_address,
      starts_at,
      ends_at,
      source,
    });
    await redisClient.incr("eventCount");
    const ev = result.rows[0];
    // Emit realtime event
    try {
      socket.getIO().emit("event:created", ev);
    } catch (e) {
      /* ignore if not init */
    }
    res.json(ev);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create event" });
  }
};

const deleteEvent = async (req, res) => {
  const { id } = req.params;
  if (!req.user)
    return res.status(401).json({ error: "Authentication required" });
  try {
    const found = await Event.getById(id);
    if (!found || found.rows.length === 0)
      return res.status(404).json({ error: "Event not found" });
    const row = found.rows[0];
    if (Number(row.user_id) !== Number(req.user.id))
      return res.status(403).json({ error: "Forbidden" });
    const result = await Event.delete(id);
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Event not found" });
    await redisClient.decr("eventCount");
    try {
      socket.getIO().emit("event:deleted", { id: Number(id) });
    } catch (e) {}
    res.json({ message: "Event deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete event" });
  }
};

const updateEvent = async (req, res) => {
  const { id } = req.params;
  const { title, description, category = 'Other' } = req.body;
  const rawStarts = req.body.starts_at;
  const rawEnds = req.body.ends_at;
  if (!req.user)
    return res.status(401).json({ error: "Authentication required" });
  if (!title || !description)
    return res.status(400).json({ error: "Missing required fields" });
  try {
    const found = await Event.getById(id);
    if (!found || found.rows.length === 0)
      return res.status(404).json({ error: "Event not found" });
    const row = found.rows[0];
    if (Number(row.user_id) !== Number(req.user.id))
      return res.status(403).json({ error: "Forbidden" });

    const starts_at = rawStarts
      ? typeof rawStarts === "string"
        ? new Date(rawStarts)
        : rawStarts
      : null;
    const ends_at = rawEnds
      ? typeof rawEnds === "string"
        ? new Date(rawEnds)
        : rawEnds
      : null;

    const result = await Event.update({
      id,
      title,
      description,
      starts_at,
      ends_at,
      category,
    });
    if (result.rowCount === 0)
      return res.status(404).json({ error: "Event not found" });
    const ev = result.rows[0];
    try {
      socket.getIO().emit("event:updated", ev);
    } catch (e) {}
    res.json(ev);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update event" });
  }
};

module.exports = {
  getEvents,
  createEvent,
  deleteEvent,
  updateEvent,
};
