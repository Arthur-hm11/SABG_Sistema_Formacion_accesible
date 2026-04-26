import pool from "./db.js";
import { getSessionRole } from "./session.js";

function normalizeUser(value) {
  return String(value || "").trim().toUpperCase();
}

export async function ensureMonitoringTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      usuario VARCHAR(120),
      accion VARCHAR(120),
      modulo VARCHAR(120),
      detalle JSONB,
      ip VARCHAR(80),
      user_agent VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monitor_heartbeats (
      usuario VARCHAR(120) PRIMARY KEY,
      rol VARCHAR(40),
      dependencia TEXT,
      route VARCHAR(160),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_accion_created_at
    ON audit_logs (accion, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_heartbeats_last_seen
    ON monitor_heartbeats (last_seen DESC)
  `);
}

export function canViewMonitoringSession(session) {
  return getSessionRole(session) === "monitor";
}

export function isMonitorOnlySession(session) {
  return getSessionRole(session) === "monitor";
}

export function getMonitoringDisplayName(session) {
  const usuario = normalizeUser(session?.usuario);
  return usuario || "MONITOR";
}

function clip(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function safeJson(value, max = 4000) {
  if (value === undefined || value === null) return null;
  const raw = JSON.stringify(value);
  if (raw.length <= max) return raw;
  return JSON.stringify({ truncated: true, preview: raw.slice(0, max) });
}

export async function logAuditEvent({
  usuario,
  accion,
  modulo,
  detalle,
  ip,
  userAgent,
}) {
  await ensureMonitoringTables();
  await pool.query(
    `
      INSERT INTO audit_logs (usuario, accion, modulo, detalle, ip, user_agent, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `,
    [
      clip(usuario, 120),
      clip(accion, 120),
      clip(modulo, 120),
      safeJson(detalle),
      clip(ip, 80),
      clip(userAgent, 300),
    ]
  );
}
