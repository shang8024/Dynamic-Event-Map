const pool = require('../config/db');

module.exports = {
  getByUser: (userId) =>
    pool.query(
      `SELECT row_to_json(e) AS event, b.created_at as bookmarked_at, b.id as id
         FROM bookmarks b
         JOIN events e ON e.id = b.event_id
         WHERE b.user_id = $1
         ORDER BY b.created_at DESC`,
      [userId]
    ),

  create: ({ eventId, userId }) =>
    pool.query(
      'INSERT INTO bookmarks (event_id, user_id) VALUES ($1, $2) RETURNING *',
      [eventId, userId]
    ),

  delete: ({ bookmarkId, userId }) => pool.query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING *', [bookmarkId, userId]),
};
