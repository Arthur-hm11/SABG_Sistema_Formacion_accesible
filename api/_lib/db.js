import { Pool } from "pg";

function toInt(value, fallback, min, max) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: toInt(process.env.PG_POOL_MAX, 12, 1, 20),
  idleTimeoutMillis: toInt(process.env.PG_IDLE_TIMEOUT_MS, 20000, 5000, 120000),
  connectionTimeoutMillis: toInt(process.env.PG_CONNECTION_TIMEOUT_MS, 8000, 1000, 30000),
  statement_timeout: toInt(process.env.PG_STATEMENT_TIMEOUT_MS, 15000, 1000, 60000),
  query_timeout: toInt(process.env.PG_QUERY_TIMEOUT_MS, 20000, 1000, 120000),
  keepAlive: true,
  keepAliveInitialDelayMillis: toInt(process.env.PG_KEEPALIVE_DELAY_MS, 10000, 1000, 60000),
});

pool.on("error", (error) => {
  console.error("Postgres pool idle client error:", error?.message || error);
});

export default pool;
