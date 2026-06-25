import crypto from "crypto";
import bcrypt from "bcryptjs";
import pool from "../_lib/db.js";
import {
  buildSabgSessionCookie,
  ensureUserSessionColumns,
  getActiveSessionTtlSeconds,
  getInactiveLockSeconds,
  getSessionCookieTtlSeconds,
} from "../_lib/session.js";

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

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://sabg-sistema-formacion.onrender.com");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ success: false, error: "Método no permitido" });

  const { usuario, password } = req.body || {};
  if (!usuario || !password)
    return res.status(400).json({ success: false, error: "Faltan credenciales" });

  const usuarioNorm = String(usuario).trim().replace(/\s+/g, " ");

  try {
    await ensureUserSessionColumns();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const q = `
        SELECT id
        FROM public.usuarios
        WHERE (
          UPPER(REGEXP_REPLACE(TRIM(usuario), '\\s+', ' ', 'g')) =
          UPPER(REGEXP_REPLACE(TRIM($1), '\\s+', ' ', 'g'))
        ) OR (
          TRANSLATE(
            UPPER(REGEXP_REPLACE(TRIM(usuario), '\\s+', ' ', 'g')),
            'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
            'AAAAAEEEEIIIIOOOOOUUUUN'
          ) =
          TRANSLATE(
            UPPER(REGEXP_REPLACE(TRIM($1), '\\s+', ' ', 'g')),
            'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
            'AAAAAEEEEIIIIOOOOOUUUUN'
          )
        )
        ORDER BY
          CASE
            WHEN usuario = $1 THEN 0
            WHEN UPPER(REGEXP_REPLACE(TRIM(usuario), '\\s+', ' ', 'g')) =
                 UPPER(REGEXP_REPLACE(TRIM($1), '\\s+', ' ', 'g')) THEN 1
            ELSE 2
          END,
          id ASC
        LIMIT 1
      `;
      const lookupRes = await client.query(q, [usuarioNorm]);

      if (!lookupRes.rows || lookupRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(401).json({ success: false, error: "Credenciales inválidas" });
      }

      const lockRes = await client.query(
        `
          SELECT id, usuario, password_hash, nombre, rol, dependencia,
                 active_session_id, active_session_expires_at, locked_until
          FROM public.usuarios
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [lookupRes.rows[0].id]
      );

      const u = lockRes.rows?.[0];
      if (!u) {
        await client.query("ROLLBACK");
        return res.status(401).json({ success: false, error: "Credenciales inválidas" });
      }

      const ok = await bcrypt.compare(String(password), String(u.password_hash));
      if (!ok) {
        await client.query("ROLLBACK");
        return res.status(401).json({ success: false, error: "Credenciales inválidas" });
      }

      const ttlSeconds = getActiveSessionTtlSeconds();
      const lockSeconds = getInactiveLockSeconds();

      const staleSessions = await client.query(
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
        [u.id, ttlSeconds]
      );

      if (staleSessions.rowCount > 0) {
        await client.query(
          `
            UPDATE public.usuarios
            SET locked_until = NOW() + ($2 * INTERVAL '1 second'),
                active_session_id = NULL,
                active_session_expires_at = NULL
            WHERE id = $1
          `,
          [u.id, lockSeconds]
        );
      } else {
        const legacySid = String(u.active_session_id || "").trim();
        const legacyExpiresAt = u.active_session_expires_at ? new Date(u.active_session_expires_at).getTime() : 0;
        if (legacySid && Number.isFinite(legacyExpiresAt) && legacyExpiresAt > Date.now()) {
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
            [legacySid, u.id, hashSessionToken(legacySid), ttlSeconds, String(req.headers["user-agent"] || "").trim() || null, String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null]
          );

          await client.query(
            `
              UPDATE public.usuarios
              SET active_session_expires_at = NOW() + ($2 * INTERVAL '1 second')
              WHERE id = $1
                AND active_session_id = $3
            `,
            [u.id, ttlSeconds, legacySid]
          );
        }
      }

      const currentStateRes = await client.query(
        `
          SELECT locked_until
          FROM public.usuarios
          WHERE id = $1
          LIMIT 1
        `,
        [u.id]
      );

      const lockedUntil = currentStateRes.rows?.[0]?.locked_until || null;
      if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
        await client.query("COMMIT");
        return res.status(423).json({ success: false, error: buildLockedMessage(lockedUntil) });
      }

      const activeSessionRes = await client.query(
        `
          SELECT id
          FROM public.user_sessions
          WHERE user_id = $1
            AND status = 'active'
          LIMIT 1
        `,
        [u.id]
      );

      if (activeSessionRes.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: buildSessionInUseMessage() });
      }

      const sid = crypto.randomUUID();
      const sidHash = hashSessionToken(sid);

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
        `,
        [
          sid,
          u.id,
          sidHash,
          ttlSeconds,
          String(req.headers["user-agent"] || "").trim() || null,
          String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null,
        ]
      );

      await client.query(
        `
          UPDATE public.usuarios
          SET active_session_id = $2,
              active_session_expires_at = NOW() + ($3 * INTERVAL '1 second'),
              locked_until = NULL
          WHERE id = $1
        `,
        [u.id, sid, ttlSeconds]
      );

      await client.query("COMMIT");

      const payload = {
        id: u.id,
        usuario: u.usuario,
        rol: u.rol,
        dependencia: u.dependencia,
        exp: Math.floor(Date.now() / 1000) + getSessionCookieTtlSeconds(),
        sid,
      };

      const cookie = buildSabgSessionCookie(req, payload, getSessionCookieTtlSeconds());
      res.setHeader("Set-Cookie", cookie);

      return res.json({
        success: true,
        usuario: u.usuario,
        nombre: u.nombre,
        rol: u.rol,
        dependencia: u.dependencia,
      });
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
  } catch (err) {
    console.error("Error /api/auth/login:", err);
    return res.status(500).json({ success: false, error: "Error interno" });
  }
}
// deploy ping 20260223_154135
