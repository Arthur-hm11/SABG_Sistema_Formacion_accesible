import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import {
  closeSabgSession,
  clearSabgSessionCookie,
  ensureUserSessionColumns,
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
    if (session?.id && session?.sid) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await closeSabgSession(client, {
          userId: session.id,
          sid: String(session.sid || ""),
          mode: "logout",
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
    }
  } catch (error) {
    console.error("Error liberando sesión activa:", error);
  }

  res.setHeader("Set-Cookie", clearSabgSessionCookie(req));
  return res.json({ success: true });
}
