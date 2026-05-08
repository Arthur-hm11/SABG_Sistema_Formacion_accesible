import { Pool } from "pg";

function toInt(value, fallback, min, max) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function getConnectionHost(connectionString = "") {
  try {
    return new URL(String(connectionString || "")).hostname || "";
  } catch {
    return "";
  }
}

function isPrivateHost(host = "") {
  const normalized = String(host || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") return true;
  if (normalized.endsWith(".internal")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return true;
  return false;
}

function buildSslConfig() {
  const sslMode = String(process.env.PG_SSL_MODE || process.env.PGSSLMODE || "").trim().toLowerCase();
  if (sslMode === "disable") return false;

  const rejectUnauthorizedEnv = String(process.env.PG_SSL_REJECT_UNAUTHORIZED || "").trim().toLowerCase();
  if (rejectUnauthorizedEnv === "false") {
    return { rejectUnauthorized: false };
  }

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  const host = getConnectionHost(connectionString);

  if (isPrivateHost(host) && rejectUnauthorizedEnv !== "true") {
    return false;
  }

  return { rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: buildSslConfig(),
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
