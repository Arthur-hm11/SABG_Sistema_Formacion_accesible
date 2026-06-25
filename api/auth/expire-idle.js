import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import {
  closeSabgSession,
  clearSabgSessionCookie,
  ensureUserSessionColumns,
  getInactiveLockSeconds,
  readSabgSession,
} from "../_lib/session.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-SABG-Session-Touch, X-SABG-No-Touch");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session?.id || !session?.sid) {
    res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
    return res.status(200).json({ success: true, expired: true, lockedSeconds: getInactiveLockSeconds() });
  }

  try {
    await ensureUserSessionColumns();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await closeSabgSession(client, {
        userId: session.id,
        sid: String(session.sid || ""),
        mode: "expired",
      });
      await client.query("COMMIT");
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
  } catch (error) {
    console.error("Error expirando sesión por inactividad:", error);
    return res.status(500).json({ success: false, error: "Error interno" });
  }

  res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
  return res.status(200).json({
    success: true,
    expired: true,
    lockedSeconds: getInactiveLockSeconds(),
  });
}
