const { Pool } = require("pg");
require("dotenv").config();
const fs = require("fs");

function readSecretFile(p) {
  try { return fs.readFileSync(p, "utf8").trim(); } catch { return undefined; }
}

const dbPassword =
  process.env.DB_PASSWORD ??
  (process.env.DB_PASSWORD_FILE && readSecretFile(process.env.DB_PASSWORD_FILE));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: dbPassword,
  database: process.env.DB_NAME,
});

module.exports = pool;
