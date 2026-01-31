const { requireAuth } = require("../_lib/auth");
const pool = require("../_lib/db.cjs");

const TABLE = "public.registros_trimestral";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error("Body JSON inválido")); }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  

    const user = await requireAuth(req, res, pool);
    if (!user) return;

if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Método no permitido" });

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : await readJsonBody(req);
    const id = Number(body?.id);
    if (!id) return res.status(400).json({ ok:false, error:"Falta id numérico" });

    const r = await pool.query(
      `DELETE FROM ${TABLE}
       WHERE id = $1
         AND trimestre = 'TEST_TERMINAL'
         AND primer_apellido = 'PRUEBA'
         AND nombre = 'TERMINAL'
         AND usuario_registro = 'Terminal'
       RETURNING id;`,
      [id]
    );

    return res.status(200).json({ ok:true, deleted: r.rowCount, id: (r.rows?.[0]?.id ?? null) });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || "Error interno" });
  }
};
