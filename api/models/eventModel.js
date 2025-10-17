const pool = require("../config/db");

module.exports = {
  getAll: () => pool.query("SELECT * FROM events ORDER BY id ASC"),
  create: ({ title, description, lat, lng }) =>
    pool.query(
      "INSERT INTO events (title, description, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING *",
      [title, description, lat, lng]
    ),
  delete: (id) => pool.query("DELETE FROM events WHERE id = $1 RETURNING *", [id]),
  update: ({ id, title, description, lat, lng }) =>
    pool.query(
      "UPDATE events SET title=$1, description=$2, latitude=$3, longitude=$4 WHERE id=$5 RETURNING *",
      [title, description, lat, lng, id]
    ),
};
