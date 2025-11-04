const Bookmark = require('../models/bookmarkModel');
const pool = require('../config/db');

async function ensureMockUser() {
  // Ensure a mock user exists (username: mockuser)
  const res = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', ['mockuser']);
  if (res.rows.length) return res.rows[0].id;
  const insert = await pool.query(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
    ['mockuser', 'mock-password']
  );
  return insert.rows[0].id;
}

const getBookmarks = async (req, res) => {
  const { userId } = req.body;
  try {
    const uid = userId || (await ensureMockUser());
    const result = await Bookmark.getByUser(uid);
    const out = result.rows.map((r) => ({
      data: r.event,
      created_at: r.bookmarked_at,
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
};

const createBookmark = async (req, res) => {
  const { eventId, userId } = req.body;
  try {
    const uid = userId || (await ensureMockUser());
    const created = await Bookmark.create({ eventId, userId: uid });
    const event_id = created.rows[0].event_id || eventId;
    const user_id = created.rows[0].user_id || uid;
    res.json({ event_id, user_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create bookmark' });
  }
};


const deleteBookmark = async (req, res) => {
  const { eventId } = req.params;
  const { userId } = req.body;
  try {
    const uid = userId || (await ensureMockUser());
    const result = await Bookmark.delete({ userId: uid, eventId });
    if (result.rowCount === 0) return res.status(404).json({ error: 'Bookmark not found' });
    res.json({ message: 'Bookmark deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
};

module.exports = { createBookmark, deleteBookmark, getBookmarks };