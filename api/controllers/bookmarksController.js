const { parse } = require('yargs');
const Bookmark = require('../models/bookmarkModel');
const socket = require("../socket");

const getBookmarks = async (req, res) => {
  const uid = req.user?.id || req.body?.userId;
  try {
    const result = await Bookmark.getByUser(uid);
    const out = result.rows.map((r) => ({
      data: r.event,
      created_at: r.bookmarked_at,
      id: r.id,
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
};

const getBookmarksStatsByEvent = async (req, res) => {
  const { eventId } = req.params;
  try {
    const result = await Bookmark.getStatsByEvent(eventId);
    const count = parseInt(result.rows[0]?.bookmark_count, 10) || 0;
    try {
      socket.getIO().emit("bookmark:updated", {eventId, count: count});
    } catch (e) {
      // no-op
    }
    res.json({ bookmark_count: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookmark stats' });
  }
};

const createBookmark = async (req, res) => {
  const { eventId } = req.params;
  const uid = req.user?.id || req.body?.userId;
  try {
    const created = await Bookmark.create({ eventId: eventId, userId: uid });
    res.json({ id: created.rows[0].id, eventId: created.rows[0].event_id, userId: created.rows[0].user_id, created_at: created.rows[0].created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create bookmark' });
  }
};


const deleteBookmark = async (req, res) => {
  const { bookmarkId } = req.params;
  const uid = req.user?.id || req.body?.userId;
  try {
    const result = await Bookmark.delete({ bookmarkId: bookmarkId, userId: uid });
    if (result.rowCount === 0) return res.status(404).json({ error: 'Bookmark not found' });
    res.json({ message: 'Bookmark deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
};

const getTodaysBookmarks = async (req, res) => {
  const uid = req.user?.id || req.body?.userId;
  const tz = req.query?.tz || 'America/Toronto';
  try {
    const result = await Bookmark.getTodaysByUser(uid, tz);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch today\'s bookmarks' });
  }
};

module.exports = { createBookmark, deleteBookmark, getBookmarks, getTodaysBookmarks, getBookmarksStatsByEvent };