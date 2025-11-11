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

  getStatsByEvent: (eventId) =>
    pool.query(
      `SELECT COUNT(*) AS bookmark_count
         FROM bookmarks
         WHERE event_id = $1`,
      [eventId]
    ),

  create: ({ eventId, userId }) =>
    pool.query(
      'INSERT INTO bookmarks (event_id, user_id) VALUES ($1, $2) RETURNING *',
      [eventId, userId]
    ),

  delete: ({ bookmarkId, userId }) => pool.query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING *', [bookmarkId, userId]),
  getTodaysByUser: (userId, tz = 'America/Toronto') =>
    pool.query(
      `
      (
        SELECT
          'starting'::text AS bucket,
          COALESCE(json_agg(row_to_json(x)), '[]'::json) AS events,
          COUNT(*)::int AS total
        FROM (
          SELECT
            e.*,
            b.created_at AS bookmarked_at,
            b.id         AS bookmark_id
          FROM bookmarks b
          JOIN events e ON e.id = b.event_id
          WHERE b.user_id = $1
            AND e.starts_at IS NOT NULL
            AND (e.starts_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
          ORDER BY e.starts_at ASC
        ) x
      )
      UNION ALL
      (
        SELECT
          'ending'::text AS bucket,
          COALESCE(json_agg(row_to_json(y)), '[]'::json) AS events,
          COUNT(*)::int AS total
        FROM (
          SELECT
            e.*,
            b.created_at AS bookmarked_at,
            b.id         AS bookmark_id
          FROM bookmarks b
          JOIN events e ON e.id = b.event_id
          WHERE b.user_id = $1
            AND e.ends_at IS NOT NULL
            AND (e.ends_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
          ORDER BY e.ends_at ASC
        ) y
      );
      `,
      [userId, tz]
    ),
  
};
