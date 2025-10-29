const { createClient } = require("redis");
require("dotenv").config();
const fs = require("fs");
const host = "redis";
const port = Number(process.env.REDIS_PORT || 6379);
const passwordFile = process.env.REDIS_PASSWORD_FILE;
const password =
  (passwordFile && fs.existsSync(passwordFile) && fs.readFileSync(passwordFile, 'utf8').trim()) ||
  (process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim()) ||
  undefined;

const redisClient = createClient({
  socket: {
    host,
    port,
  },
  ...(password ? { password } : {}),
});

redisClient.on('error', (err) => console.error('[Redis] Client Error:', err));
redisClient.on('connect', () => console.log('[Redis] connecting...'));
redisClient.on('ready', () => console.log('[Redis] ready'));
redisClient.on('reconnecting', () => console.log('[Redis] reconnecting...'));

(async () => await redisClient.connect())();

module.exports = redisClient;