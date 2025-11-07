const { Sequelize } = require('sequelize');
const fs = require('fs');
require('dotenv').config();

function readSecretFile(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return undefined; }
}

const dbPassword =
  process.env.DB_PASSWORD ??
  (process.env.DB_PASSWORD_FILE && readSecretFile(process.env.DB_PASSWORD_FILE));

const sequelize = new Sequelize(process.env.DB_NAME || 'postgres', process.env.DB_USER || 'postgres', dbPassword, {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  dialect: 'postgres',
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

module.exports = sequelize;
