const { Pool } = require("pg");

// Soporta los nombres típicos de Vercel/Neon sin romper nada.
const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

// En local normalmente NO necesitas SSL; en prod (Vercel/Neon) sí.
const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

const pool = new Pool({
  connectionString,
  ssl: isProd ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

module.exports = pool;
