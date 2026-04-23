import { Pool } from "pg";

function toInt(value, fallback, min, max) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: toInt(process.env.PG_POOL_MAX, 5, 1, 20),
  idleTimeoutMillis: toInt(process.env.PG_IDLE_TIMEOUT_MS, 30000, 5000, 120000),
  connectionTimeoutMillis: toInt(process.env.PG_CONNECTION_TIMEOUT_MS, 5000, 1000, 30000),
});

export default pool;
