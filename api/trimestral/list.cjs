const { requireAuth } = require("../_lib/auth");
const pool = require("../_lib/db.cjs");

const TABLE = "public.registros_trimestral";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // Auth (cookies httpOnly)
  const user = await requireAuth(req, res, pool);
  if (!user) return;

  // --- Compatibilidad: POST deleteTest desde /list ---
  // Se mantiene para no romper el HTML si ya llama POST /api/trimestral/list.
  if (req.method === "POST") {
    try {
      const body = (req.body && typeof req.body === "object") ? req.body : await readJsonBody(req);
      const id = Number(body?.id);
      const deleteTest = body?.deleteTest === true;

      if (!deleteTest) {
        return res.status(400).json({ success: false, error: "POST no soportado (falta deleteTest:true)" });
      }
      if (!id) {
        return res.status(400).json({ success: false, error: "Falta id numérico" });
      }

      const r = await pool.query(
        `DELETE FROM ${TABLE}
         WHERE id = $1
           AND TRIM(COALESCE(trimestre,'')) LIKE 'TEST_%'
         RETURNING id;`,
        [id]
      );

      return res.status(200).json({
        success: true,
        ok: true,
        deleted: r.rowCount,
        id: (r.rows?.[0]?.id ?? null),
      });
    } catch (e) {
      return res.status(500).json({ success: false, ok: false, error: String(e?.message || e || "Error") });
    }
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    const dependencia = req.query?.dependencia;

    let q = `SELECT * FROM ${TABLE} ORDER BY created_at DESC`;
    const params = [];

    if (dependencia && dependencia !== "null") {
      q = `SELECT * FROM ${TABLE} WHERE dependencia ILIKE $1 ORDER BY created_at DESC`;
      params.push(`%${dependencia}%`);
    }

    const result = await pool.query(q, params);
    return res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Error /api/trimestral/list:", error);
    return res.status(500).json({ success: false, error: error?.message || String(error) });
  }
};
