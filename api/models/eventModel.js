const pool = require("../config/db");

module.exports = {
  getAll: () => pool.query("SELECT * FROM events ORDER BY id ASC"),
  getById: (id) =>
    pool.query("SELECT * FROM events WHERE id = $1 LIMIT 1", [id]),
  create: ({
    user_id = null,
    title,
    description,
    category,
    lat,
    lng,
    location_address,
    starts_at,
    ends_at,
    source = "internal",
  }) =>
    pool.query(
      "INSERT INTO events (user_id, title, category, description, latitude, longitude, location_address, starts_at, ends_at, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *",
      [
        user_id,
        title,
        category,
        description,
        lat,
        lng,
        location_address,
        starts_at,
        ends_at,
        source,
      ]
    ),

  delete: (id) =>
    pool.query("DELETE FROM events WHERE id = $1 RETURNING *", [id]),
  update: ({ id, title, description, starts_at, ends_at, category }) =>
    pool.query(
      "UPDATE events SET title=$1, description=$2, category=$3, starts_at=$4, ends_at=$5, updated_at = CURRENT_TIMESTAMP WHERE id=$6 RETURNING *",
      [title, description, category, starts_at, ends_at, id]
    ),
};
