const { createClient } = require("redis");
require("dotenv").config();

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));

(async () => await redisClient.connect())();

module.exports = redisClient;