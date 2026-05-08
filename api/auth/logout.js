import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import {
  clearSabgSessionCookie,
  ensureUserSessionColumns,
  getSessionRole,
  readSabgSession,
} from "../_lib/session.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    await ensureUserSessionColumns();

    const session = readSabgSession(req);
    if (session && getSessionRole(session) !== "superadmin") {
      await pool.query(
        `
          UPDATE public.usuarios
          SET active_session_id = NULL,
              active_session_expires_at = NULL
          WHERE id = $1
            AND active_session_id = $2
        `,
        [session.id, String(session.sid || "")]
      );
    }
  } catch (error) {
    console.error("Error liberando sesión activa:", error);
  }

  res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
  return res.json({ success: true });
}
