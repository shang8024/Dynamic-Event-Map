const Event = require("../models/eventModel");
const redisClient = require("../config/redis");

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
    const { title, description, lat, lng } = req.body;
    if (!title || !lat || !lng) return res.status(400).json({ error: "Missing required fields" });

    try {
        const result = await Event.create({ title, description, lat, lng });
        await redisClient.incr("eventCount");
        res.json(result.rows[0]);
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
        res.json({ message: "Event deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete event" });
    }
};

const updateEvent = async (req, res) => {
    const { id } = req.params;
    const { title, description, lat, lng } = req.body;
    try {
        const result = await Event.update({ id, title, description, lat, lng });
        if (result.rowCount === 0) return res.status(404).json({ error: "Event not found" });
        res.json(result.rows[0]);
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
