const Comment = require('../models/commentModel');
const pool = require('../config/db');
const socket = require('../socket');

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

const getUserComments = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const result = await Comment.getByUser(req.user.id);
    const out = result.rows.map((r) => ({
      comment: {
        id: r.id,
        text: r.text,
        createdAt: r.created_at,
      },
      event: r.event_id ? {
        id: r.event_id,
        title: r.title,
        data: r.data,
        position: (r.latitude && r.longitude) ? { lat: r.latitude, lng: r.longitude } : null,
        locationAddress: r.location_address,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      } : null,
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user comments' });
  }
};

const createComment = async (req, res) => {
  const { eventId } = req.params;
  const { text } = req.body;
  // Must be authenticated
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'Missing comment text' });
  try {
    const uid = req.user.id;
    const created = await Comment.create({ eventId, userId: uid, text });
    const id = created.rows[0].id;
    // Return the created comment with username
    const found = await pool.query(
      `SELECT c.id, c.text, c.created_at, p.id AS user_id, p.username
       FROM comments c JOIN profiles p ON p.id = c.user_id WHERE c.id = $1 LIMIT 1`,
      [id]
    );
    const r = found.rows[0];
    const commentData = { id: r.id, text: r.text, user: { id: r.user_id, name: r.username }, createdAt: r.created_at };
    res.json(commentData);
    // Emit realtime comment created
    try { 
      const payload = { eventId: Number(eventId), ...commentData };
      socket.getIO().emit('comment:created', payload);
      console.log(`[Socket.IO] Emitted comment:created for event ${eventId}, comment ${r.id}`);
    } catch (e) {
      console.error('[Socket.IO] Failed to emit comment:created:', e);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};

const deleteComment = async (req, res) => {
  const { commentId } = req.params;
  // Auth required
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    // Verify ownership
    const found = await Comment.getById(commentId);
    if (!found || found.rows.length === 0) return res.status(404).json({ error: 'Comment not found' });
    const row = found.rows[0];
    if (Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const result = await Comment.delete(commentId);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Comment not found' });
    try { 
      const payload = { eventId: Number(req.params.eventId), id: Number(commentId) };
      socket.getIO().emit('comment:deleted', payload);
      console.log(`[Socket.IO] Emitted comment:deleted for event ${req.params.eventId}, comment ${commentId}`);
    } catch (e) {
      console.error('[Socket.IO] Failed to emit comment:deleted:', e);
    }
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
};

module.exports = { getComments, getUserComments, createComment, deleteComment };
