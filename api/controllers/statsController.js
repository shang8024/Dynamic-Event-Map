const redisClient = require("../config/redis");
const pool = require("../config/db");

async function initializeEventCount() {
  const exists = await redisClient.exists("eventCount");
  if (!exists) {
    const res = await pool.query("SELECT COUNT(*)::int FROM events");
    await redisClient.set("eventCount", res.rows[0].count);
  }
}

const getStats = async (req, res) => {
  try {
    await initializeEventCount();
    const count = await redisClient.get("eventCount");
    res.json({ eventCount: parseInt(count, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  getStats,
};
