import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isSuperAdminSession } from "../_lib/session.js";

const TABLE = "public.registros_trimestral";

function setCors(req, res) {
  const pre = applyCors(req, res);
  if (pre) return pre;
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Body JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const pre = setCors(req, res);
  if (pre) return;
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Método no permitido" });

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ ok:false, error:"No autenticado" });
  if (!isSuperAdminSession(session)) return res.status(403).json({ ok:false, error:"Solo superadmin puede eliminar registros trimestrales" });

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : await readJsonBody(req);

    const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) {
      return res.status(400).json({ ok:false, error:"Faltan ids válidos" });
    }
    if (ids.length > 500) {
      return res.status(400).json({ ok:false, error:"Máximo 500 registros por eliminación" });
    }

    const r = await pool.query(
      `DELETE FROM ${TABLE}
       WHERE id = ANY($1::int[])
       RETURNING id;`,
      [ids]
    );

    return res.status(200).json({
      ok: true,
      deleted: r.rowCount,
      ids: r.rows.map(x => x.id)
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error: "Error interno" });
  }
}
