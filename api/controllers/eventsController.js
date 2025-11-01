const Event = require("../models/eventModel");
const redisClient = require("../config/redis");
const socket = require("../socket");

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
    const { title, description } = req.body;
    const lat = req.body.latitude;
    const lng = req.body.longitude;
    if (!title || lat === undefined || lng === undefined) return res.status(400).json({ error: "Missing required fields" });

    try {
        const result = await Event.create({ title, description, lat, lng, source: 'internal' });
        await redisClient.incr("eventCount");
        const ev = result.rows[0];
        // Emit realtime event
        try { socket.getIO().emit("event:created", ev); } catch (e) { /* ignore if not init */ }
        res.json(ev);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create event" });
    }
};

const deleteEvent = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await Event.delete(id);
        if (result.rowCount === 0) return res.status(404).json({ error: "Event not found" });
        await redisClient.decr("eventCount");
        try { socket.getIO().emit("event:deleted", { id: Number(id) }); } catch (e) {}
        res.json({ message: "Event deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete event" });
    }
};

const updateEvent = async (req, res) => {
    const { id } = req.params;
    const { title, description } = req.body;
    const lat = req.body.lat ?? req.body.latitude;
    const lng = req.body.lng ?? req.body.longitude;
    try {
        const result = await Event.update({ id, title, description, lat, lng });
        if (result.rowCount === 0) return res.status(404).json({ error: "Event not found" });
        const ev = result.rows[0];
        try { socket.getIO().emit("event:updated", ev); } catch (e) {}
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
