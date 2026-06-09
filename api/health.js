import pool from "./_lib/db.js";
import { applyCors } from "./_lib/cors.js";
import { isAdminSession, isMonitorSession, validateSabgSession } from "./_lib/session.js";

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]);
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "Metodo no permitido" });
  }

  const started = Date.now();
  const deep = String(req.query?.deep || "").trim() === "1";
  const checks = {
    server: "ok",
    database: "unknown",
  };

  let session = null;
  if (deep) {
    try {
      session = await validateSabgSession(req, res);
    } catch (error) {
      console.error("Error validando sesión para deep health:", error);
      return res.status(500).json({
        ok: false,
        error: "Error validando la sesión",
        checks: {
          server: "ok",
          database: "hidden",
        },
        responseMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      });
    }

    if (!session || (!isAdminSession(session) && !isMonitorSession(session))) {
      return res.status(!session ? 401 : 403).json({
        ok: false,
        error: "No autorizado para ver el estado profundo del sistema",
        checks: {
          server: "ok",
          database: "hidden",
        },
        responseMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      });
    }
  }

  try {
    await withTimeout(pool.query("SELECT 1 AS ok"), deep ? 3000 : 2500);
    checks.database = "ok";

    return res.status(200).json({
      ok: true,
      checks,
      uptimeSeconds: Math.round(process.uptime()),
      responseMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    checks.database = "error";
    return res.status(503).json({
      ok: false,
      checks,
      responseMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  }
}
