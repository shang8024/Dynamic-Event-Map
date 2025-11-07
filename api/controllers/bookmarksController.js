const Bookmark = require('../models/bookmarkModel');
const pool = require('../config/db');

async function ensureMockUser() {
  // Ensure a mock user exists (username: mockuser)
  const res = await pool.query('SELECT id FROM profiles WHERE username = $1 LIMIT 1', ['mockuser']);
  if (res.rows.length) return res.rows[0].id;
  const insert = await pool.query(
    "INSERT INTO profiles (username, password_hash) VALUES ($1, $2) RETURNING id",
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
      id: r.id,
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
};

const createBookmark = async (req, res) => {
  const { eventId } = req.params;
  const { userId } = req.body;
  try {
    const uid = userId || (await ensureMockUser());
    const created = await Bookmark.create({ eventId, userId: uid });
    res.json({ id: created.rows[0].id, eventId: created.rows[0].event_id, userId: created.rows[0].user_id, created_at: created.rows[0].created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create bookmark' });
  }
};


const deleteBookmark = async (req, res) => {
  const { bookmarkId } = req.params;
  // const { userId } = req.body;
  try {
    // const uid = userId || (await ensureMockUser());
    // // Check that the bookmark belongs to the user
    // const bookmark = await pool.query('SELECT id FROM bookmarks WHERE id = $1 AND user_id = $2', [bookmarkId, uid]);
    // if (bookmark.rows.length === 0) {
    //   return res.status(404).json({ error: 'Bookmark not found or not owned by user' });
    // }
    const result = await Bookmark.delete({ bookmarkId });
    if (result.rowCount === 0) return res.status(404).json({ error: 'Bookmark not found' });
    res.json({ message: 'Bookmark deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
};

module.exports = { createBookmark, deleteBookmark, getBookmarks };