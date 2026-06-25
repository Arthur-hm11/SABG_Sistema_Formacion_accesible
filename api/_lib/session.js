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

export function getActiveSessionTtlSeconds() {
  const raw = parseInt(String(process.env.ACTIVE_SESSION_TTL_SECONDS || ""), 10);
  if (Number.isFinite(raw) && raw >= 30 * 60 && raw <= 24 * 60 * 60) return raw;
  return 30 * 60;
}

export function getSessionActivityTouchSeconds() {
  const raw = parseInt(String(process.env.SESSION_ACTIVITY_TOUCH_SECONDS || ""), 10);
  if (Number.isFinite(raw) && raw >= 15 && raw <= 15 * 60) return raw;
  return 60;
}

export function getInactiveLockSeconds() {
  const raw = parseInt(String(process.env.INACTIVE_SESSION_LOCK_SECONDS || ""), 10);
  if (Number.isFinite(raw) && raw >= 60 && raw <= 15 * 60) return raw;
  return 3 * 60;
}

export function getSessionCookieTtlSeconds() {
  const raw = parseInt(String(process.env.SESSION_COOKIE_TTL_SECONDS || ""), 10);
  if (Number.isFinite(raw) && raw >= 30 * 60 && raw <= 7 * 24 * 60 * 60) return raw;
  return 8 * 60 * 60;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function shouldTouchSessionActivity(req) {
  const raw = String(
    req?.headers?.["x-sabg-session-touch"] ??
    req?.headers?.["x-sabg-no-touch"] ??
    ""
  ).trim().toLowerCase();

  if (raw === "0" || raw === "false" || raw === "off" || raw === "no" || raw === "none" || raw === "background") {
    return false;
  }

  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") {
    return true;
  }

  return true;
}

function getRequestIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || null;
}

function getRequestUserAgent(req) {
  const ua = String(req?.headers?.["user-agent"] || "").trim();
  return ua ? ua.slice(0, 500) : null;
}

function buildSessionInUseMessage() {
  return "Esta cuenta ya está en uso. Cierra la sesión activa o espera a que expire por inactividad.";
}

function buildLockedMessage(lockedUntil) {
  const lockedAt = new Date(lockedUntil).getTime();
  if (!Number.isFinite(lockedAt)) {
    return "Tu sesión anterior se cerró por inactividad. La cuenta estará disponible en 3 minutos.";
  }

  const remainingSeconds = Math.max(1, Math.ceil((lockedAt - Date.now()) / 1000));
  const remainingMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));

  if (remainingMinutes === 1) {
    return "Tu sesión anterior se cerró por inactividad. La cuenta estará disponible en 1 minuto.";
  }

  return `Tu sesión anterior se cerró por inactividad. La cuenta estará disponible en ${remainingMinutes} minutos.`;
}

function setSessionStatusHeaders(res, status, extras = {}) {
  if (!res?.setHeader) return;
  res.setHeader("X-SABG-Session-Status", String(status || ""));
  Object.entries(extras).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    res.setHeader(key, String(value));
  });
}

async function ensureSessionSchemaWith(client) {
  await client.query(`
      ALTER TABLE public.usuarios
      ADD COLUMN IF NOT EXISTS active_session_id TEXT,
      ADD COLUMN IF NOT EXISTS active_session_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.user_sessions (
      id UUID PRIMARY KEY,
      user_id BIGINT NOT NULL,
      session_token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      logged_out_at TIMESTAMPTZ NULL,
      expired_at TIMESTAMPTZ NULL,
      user_agent TEXT NULL,
      ip TEXT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT user_sessions_status_check CHECK (status IN ('active', 'logged_out', 'expired'))
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_status
      ON public.user_sessions (user_id, status, last_activity_at DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity
      ON public.user_sessions (last_activity_at DESC)
  `);
}

export async function ensureUserSessionColumns(client = pool) {
  if (client !== pool) {
    return ensureSessionSchemaWith(client);
  }

  if (!ensureUserSessionColumnsPromise) {
    ensureUserSessionColumnsPromise = ensureSessionSchemaWith(pool).catch((error) => {
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

async function expireCurrentSessionByInactivity(client, { userId, sid }) {
  const sidHash = hashSessionToken(sid);
  const lockSeconds = getInactiveLockSeconds();
  const ttlSeconds = getActiveSessionTtlSeconds();

  await client.query(
    `
      UPDATE public.user_sessions
      SET status = 'expired',
          expired_at = COALESCE(expired_at, NOW()),
          expires_at = NOW(),
          updated_at = NOW()
      WHERE user_id = $1
        AND session_token_hash = $2
        AND status = 'active'
    `,
    [userId, sidHash]
  );

  await client.query(
    `
      UPDATE public.usuarios
      SET locked_until = NOW() + ($2 * INTERVAL '1 second'),
          active_session_id = NULL,
          active_session_expires_at = NULL
      WHERE id = $1
    `,
    [userId, lockSeconds]
  );

  return {
    sessionStatus: "inactive_locked",
    message: buildLockedMessage(new Date(Date.now() + (lockSeconds * 1000)).toISOString()),
    ttlSeconds,
    lockSeconds,
  };
}

async function expireStaleSessionsForUser(client, userId) {
  const ttlSeconds = getActiveSessionTtlSeconds();
  const lockSeconds = getInactiveLockSeconds();

  const stale = await client.query(
    `
      UPDATE public.user_sessions
      SET status = 'expired',
          expired_at = COALESCE(expired_at, NOW()),
          expires_at = NOW(),
          updated_at = NOW()
      WHERE user_id = $1
        AND status = 'active'
        AND last_activity_at <= NOW() - ($2 * INTERVAL '1 second')
      RETURNING id
    `,
    [userId, ttlSeconds]
  );

  if (stale.rowCount > 0) {
    await client.query(
      `
        UPDATE public.usuarios
        SET locked_until = NOW() + ($2 * INTERVAL '1 second'),
            active_session_id = NULL,
            active_session_expires_at = NULL
        WHERE id = $1
      `,
      [userId, lockSeconds]
    );
  }

  return stale.rowCount;
}

async function migrateLegacyActiveSessionIfNeeded(client, { userId, sid, activeSessionId, activeSessionExpiresAt, userAgent, ip }) {
  const cleanSid = String(sid || "").trim();
  if (!cleanSid) return null;

  const legacySid = String(activeSessionId || "").trim();
  const legacyExpiresAt = activeSessionExpiresAt ? new Date(activeSessionExpiresAt).getTime() : 0;

  if (!legacySid || legacySid !== cleanSid || !Number.isFinite(legacyExpiresAt) || legacyExpiresAt <= Date.now()) {
    return null;
  }

  const sidHash = hashSessionToken(cleanSid);
  await client.query(
    `
      INSERT INTO public.user_sessions (
        id,
        user_id,
        session_token_hash,
        status,
        created_at,
        last_activity_at,
        expires_at,
        user_agent,
        ip,
        updated_at
      )
      VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW() + ($4 * INTERVAL '1 second'), $5, $6, NOW())
      ON CONFLICT (id) DO NOTHING
    `,
    [cleanSid, userId, sidHash, getActiveSessionTtlSeconds(), userAgent, ip]
  );

  await client.query(
    `
      UPDATE public.usuarios
      SET active_session_expires_at = NOW() + ($2 * INTERVAL '1 second')
      WHERE id = $1
        AND active_session_id = $3
    `,
    [userId, getActiveSessionTtlSeconds(), cleanSid]
  );

  const res = await client.query(
    `
      SELECT id, user_id, status, last_activity_at, expires_at
      FROM public.user_sessions
      WHERE user_id = $1
        AND session_token_hash = $2
      LIMIT 1
    `,
    [userId, sidHash]
  );

  return res.rows?.[0] || null;
}

export async function closeSabgSession(client, { userId, sid, mode = "logout" }) {
  const sidClean = String(sid || "").trim();
  if (!sidClean) return { success: false, mode, userId };

  const sidHash = hashSessionToken(sidClean);

  if (mode === "expired") {
    return expireCurrentSessionByInactivity(client, { userId, sid: sidClean });
  }

  await client.query(
    `
      UPDATE public.user_sessions
      SET status = 'logged_out',
          logged_out_at = COALESCE(logged_out_at, NOW()),
          expires_at = NOW(),
          updated_at = NOW()
      WHERE user_id = $1
        AND session_token_hash = $2
        AND status = 'active'
    `,
    [userId, sidHash]
  );

  await client.query(
    `
      UPDATE public.usuarios
      SET active_session_id = NULL,
          active_session_expires_at = NULL
      WHERE id = $1
        AND active_session_id = $2
    `,
    [userId, sidClean]
  );

  return { success: true, mode };
}

export async function validateSabgSession(req, res) {
  const payload = parseSabgSessionPayload(req);
  req.sabgSession = null;
  if (!payload) return null;

  await ensureUserSessionColumns();

  const sid = String(payload.sid || "").trim();
  if (!sid) {
    if (res?.setHeader) res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
    return null;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userRes = await client.query(
      `
        SELECT id, locked_until, active_session_id, active_session_expires_at
        FROM public.usuarios
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [payload.id]
    );

    const userRow = userRes.rows?.[0];
    if (!userRow) {
      await client.query("ROLLBACK");
      if (res?.setHeader) res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
      return null;
    }

    const sidHash = hashSessionToken(sid);
    let sessionRes = await client.query(
      `
        SELECT id, status, last_activity_at, expires_at
        FROM public.user_sessions
        WHERE user_id = $1
          AND session_token_hash = $2
        LIMIT 1
      `,
      [payload.id, sidHash]
    );

    let sessionRow = sessionRes.rows?.[0] || null;
    if (!sessionRow) {
      sessionRow = await migrateLegacyActiveSessionIfNeeded(client, {
        userId: payload.id,
        sid,
        activeSessionId: userRow.active_session_id,
        activeSessionExpiresAt: userRow.active_session_expires_at,
        userAgent: getRequestUserAgent(req),
        ip: getRequestIp(req),
      });
    }

    if (!sessionRow || String(sessionRow.status || "") !== "active") {
      await client.query("ROLLBACK");
      if (res?.setHeader) res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
      return null;
    }

    const lastActivityAt = sessionRow.last_activity_at ? new Date(sessionRow.last_activity_at).getTime() : 0;
    const ttlMs = getActiveSessionTtlSeconds() * 1000;
    const expiredByInactivity = !Number.isFinite(lastActivityAt) || lastActivityAt + ttlMs <= Date.now();

    if (expiredByInactivity) {
      const expiredInfo = await expireCurrentSessionByInactivity(client, { userId: payload.id, sid });
      await client.query("COMMIT");
      if (res?.setHeader) {
        res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
        setSessionStatusHeaders(res, expiredInfo.sessionStatus, {
          "X-SABG-Lock-Seconds": expiredInfo.lockSeconds,
        });
      }
      return null;
    }

    if (shouldTouchSessionActivity(req)) {
      const touchMs = getSessionActivityTouchSeconds() * 1000;
      if (!Number.isFinite(lastActivityAt) || Date.now() - lastActivityAt >= touchMs) {
        await client.query(
          `
            UPDATE public.user_sessions
            SET last_activity_at = NOW(),
                expires_at = NOW() + ($2 * INTERVAL '1 second'),
                updated_at = NOW(),
                user_agent = COALESCE($3, user_agent),
                ip = COALESCE($4, ip)
            WHERE user_id = $1
              AND session_token_hash = $5
              AND status = 'active'
          `,
          [payload.id, getActiveSessionTtlSeconds(), getRequestUserAgent(req), getRequestIp(req), sidHash]
        );

        await client.query(
          `
            UPDATE public.usuarios
            SET active_session_expires_at = NOW() + ($2 * INTERVAL '1 second')
            WHERE id = $1
              AND active_session_id = $3
          `,
          [payload.id, getActiveSessionTtlSeconds(), sid]
        );
      }
    }

    await client.query("COMMIT");
    req.sabgSession = payload;
    return payload;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // noop
    }
    throw error;
  } finally {
    client.release();
  }
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
