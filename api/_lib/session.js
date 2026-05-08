import crypto from "crypto";
import { serialize } from "cookie";
import pool from "./db.js";

function parseCookies(cookieHeader = "") {
  const out = {};
  String(cookieHeader || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function parseSabgSessionPayload(req) {
  try {
    const cookies = parseCookies(req?.headers?.cookie || "");
    const raw = cookies.sabg_session;
    if (!raw || !raw.includes(".")) return null;

    const [payloadB64, sig] = raw.split(".");
    const secret = process.env.SESSION_SECRET || "";
    if (!secret) return null;

    const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const sigBuf = Buffer.from(String(sig || ""), "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }

    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");

    const payload = JSON.parse(json);
    if (!payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function readSabgSession(req) {
  if (Object.prototype.hasOwnProperty.call(req || {}, "sabgSession")) {
    return req?.sabgSession || null;
  }
  return parseSabgSessionPayload(req);
}

let ensureUserSessionColumnsPromise = null;

export async function ensureUserSessionColumns() {
  if (!ensureUserSessionColumnsPromise) {
    ensureUserSessionColumnsPromise = pool.query(`
      ALTER TABLE public.usuarios
      ADD COLUMN IF NOT EXISTS active_session_id TEXT,
      ADD COLUMN IF NOT EXISTS active_session_expires_at TIMESTAMPTZ
    `).catch((error) => {
      ensureUserSessionColumnsPromise = null;
      throw error;
    });
  }
  return ensureUserSessionColumnsPromise;
}

function isSecureRequest(req) {
  return (
    String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ||
    req?.secure === true ||
    process.env.RENDER === "true" ||
    process.env.NODE_ENV === "production"
  );
}

export function signSabgSession(payload) {
  const secret = process.env.SESSION_SECRET || "";
  if (!secret) throw new Error("Missing SESSION_SECRET");

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${payloadB64}.${sig}`;
}

export function buildSabgSessionCookie(req, payload, maxAgeSeconds = 60 * 60 * 8) {
  return serialize("sabg_session", signSabgSession(payload), {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearSabgSessionCookie(req) {
  return serialize("sabg_session", "", {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function validateSabgSession(req, res) {
  const payload = parseSabgSessionPayload(req);
  req.sabgSession = null;
  if (!payload) return null;

  if (getSessionRole(payload) === "superadmin") {
    req.sabgSession = payload;
    return payload;
  }

  await ensureUserSessionColumns();

  const sid = String(payload.sid || "").trim();
  if (!sid) {
    if (res?.setHeader) res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
    return null;
  }

  const result = await pool.query(
    `
      SELECT active_session_id, active_session_expires_at
      FROM public.usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [payload.id]
  );

  const row = result.rows?.[0];
  const expiresAt = row?.active_session_expires_at ? new Date(row.active_session_expires_at).getTime() : 0;
  const isValid =
    !!row &&
    String(row.active_session_id || "") === sid &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now();

  if (!isValid) {
    if (res?.setHeader) res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
    return null;
  }

  req.sabgSession = payload;
  return payload;
}

export function isAdminSession(session) {
  const rol = getSessionRole(session);
  return rol === "admin" || rol === "superadmin";
}

export function isSuperAdminSession(session) {
  return getSessionRole(session) === "superadmin";
}

export function isMonitorSession(session) {
  return getSessionRole(session) === "monitor";
}

export function getSessionRole(session) {
  const rol = String(session?.rol || "").toLowerCase().trim();
  return rol === "administrador" ? "admin" : rol;
}
