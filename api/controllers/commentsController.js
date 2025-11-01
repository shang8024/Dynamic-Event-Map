const Comment = require('../models/commentModel');
const pool = require('../config/db');
const socket = require('../socket');

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

const getComments = async (req, res) => {
  const { eventId } = req.params;
  try {
    const result = await Comment.getByEvent(eventId);
    const out = result.rows.map((r) => ({
      id: r.id,
      text: r.text,
      user: { id: r.user_id, name: r.username },
      createdAt: r.created_at,
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};

const createComment = async (req, res) => {
  const { eventId } = req.params;
  const { text, userId } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Missing comment text' });
  try {
    const uid = userId || (await ensureMockUser());
    const created = await Comment.create({ eventId, userId: uid, text });
    const id = created.rows[0].id;
    // Return the created comment with username
    const found = await pool.query(
      `SELECT c.id, c.text, c.created_at, u.id AS user_id, u.username
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1 LIMIT 1`,
      [id]
    );
    const r = found.rows[0];
  res.json({ id: r.id, text: r.text, user: { id: r.user_id, name: r.username }, createdAt: r.created_at });
    // Emit realtime comment created
    try { socket.getIO().emit('comment:created', { eventId: Number(eventId), id: r.id, text: r.text, user: { id: r.user_id, name: r.username }, createdAt: r.created_at }); } catch (e) {}
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};

const deleteComment = async (req, res) => {
  const { commentId } = req.params;
  try {
    const result = await Comment.delete(commentId);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Comment not found' });
    try { socket.getIO().emit('comment:deleted', { eventId: Number(req.params.eventId), id: Number(commentId) }); } catch (e) {}
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
};

module.exports = { getComments, createComment, deleteComment };
