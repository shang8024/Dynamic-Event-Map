const redisClient = require("../config/redis");
const pool = require("../config/db");

async function invalidateEventCountCache() {
  try {
    const iter = redisClient.scanIterator({ MATCH: "events:summary:*", COUNT: 200 });
    const toDelete = [];
    for await (const key of iter) {
      toDelete.push(key);
    }
    if (toDelete.length > 0) {
      await redisClient.del(toDelete);
    }
  } catch (err) {
    console.error("[invalidateEventCountCache] error:", err);
  }
}

async function initializeEventCount() {
  const exists = await redisClient.exists("eventCount");
  if (!exists) {
    const res = await pool.query("SELECT COUNT(*)::int FROM events");
    await redisClient.set("eventCount", res.rows[0].count, { EX: 43200 });
  }
}

async function bumpEventCount(delta) {
  await initializeEventCount();
  await redisClient.incrBy("eventCount", delta);
  await invalidateEventCountCache();
}

function getLocalYYYYMMDD(tz = "America/Toronto") {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // e.g. 2025-11-09
}

function secondsUntilLocalMidnight(tz = "America/Toronto") {
  const now = new Date();
  const todayStr = getLocalYYYYMMDD(tz);
  const [y, m, d] = todayStr.split("-").map(Number);
  const nextLocalMidnight = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  const ttlMs = nextLocalMidnight - now;
  return Math.max(60, Math.floor(ttlMs / 1000));
}

async function getTodayCounts(req, res) {
  const tz = req.query.tz || "America/Toronto";
  const localDate = getLocalYYYYMMDD(tz);
  const redisKey = `events:summary:${tz}:${localDate}`;

  try {
    const cached = await redisClient.get(redisKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    const sql = `
      SELECT
        SUM(
          CASE
            WHEN starts_at IS NOT NULL
             AND (starts_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date
            THEN 1 ELSE 0
          END
        )::int AS starting,
        SUM(
          CASE
            WHEN ends_at IS NOT NULL
             AND (ends_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date
            THEN 1 ELSE 0
          END
        )::int AS ending
      FROM events
    `;
    const { rows } = await pool.query(sql, [tz]);
    const payload = {
      date: localDate,
      tz,
      starting: rows[0]?.starting ?? 0,
      ending: rows[0]?.ending ?? 0,
    };

    await redisClient.set(redisKey, JSON.stringify(payload), {
      EX: secondsUntilLocalMidnight(tz),
    });

    return res.json(payload);
  } catch (err) {
    console.error("[getTodayCounts] error:", err);
    return res.status(500).json({ error: "Server error" });
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
  getTodayCounts,
  invalidateEventCountCache,
  bumpEventCount,
  getStats,
};
