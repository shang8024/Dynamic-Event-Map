const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
var corsOptions = {
  origin: "http://localhost:" + (process.env.FRONTEND_PORT || 3000),
};

// Middleware to parse JSON request bodies
app.use(express.json());
app.use(cors(corsOptions));

// Note: This application requires Docker Compose to set environment variables
// (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, REDIS_HOST, REDIS_PORT).
// Run with `docker compose up --build -d`, not `npm start` directly.

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Redis connection
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
});

// Handle Redis connection errors
redisClient.on("error", (err) => console.error("Redis Client Error", err));

// Connect to Redis
(async () => {
  await redisClient.connect();
})();

// Initialize eventCount in Redis if not set
async function initializeEventCount() {
    const exists = await redisClient.exists("eventCount");
    if (!exists) {
        const res = await pool.query("SELECT COUNT(*)::int FROM events");
        await redisClient.set("eventCount", res.rows[0].count);
    }
}

// GET /stats: Retrieve cached task count
app.get("/stats", async (req, res) => {
  try {
    await initializeEventCount();
    const count = await redisClient.get("eventCount");
    res.json({ eventCount: parseInt(count, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});