const pool = require('../config/db');

module.exports = {
  getByEvent: (eventId) =>
    pool.query(
      `SELECT c.id, c.text, c.created_at, u.id AS user_id, u.username
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.event_id = $1
       ORDER BY c.created_at DESC`,
      [eventId]
    ),

  create: ({ eventId, userId, text }) =>
    pool.query(
      'INSERT INTO comments (event_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
      [eventId, userId, text]
    ),

  delete: (commentId) => pool.query('DELETE FROM comments WHERE id = $1 RETURNING *', [commentId]),
};
