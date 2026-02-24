import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";

function toInt(v, def) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
}

function cleanLike(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  return s;
}

export default async function handler(req, res) {
  // CORS
  const pre = applyCors(req, res);
  if (pre) return;
  // SECURITY: block public access (PII)
  const cookie = String(req.headers.cookie || "");
  if (!cookie.includes("sabg_session=")) return res.status(401).json({ success:false, error:"Unauthorized" });

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    // Params
    const page = Math.max(1, toInt(req.query?.page, 1));
    const limitRaw = toInt(req.query?.limit, 200);     // default 200 (para que tu HTML no sufra)
    const limit = Math.min(500, Math.max(1, limitRaw)); // tope 500 para no reventar Vercel
    const offset = (page - 1) * limit;

    const dependencia = cleanLike(req.query?.dependencia);
    const trimestre = cleanLike(req.query?.trimestre);
    const q = cleanLike(req.query?.q);

    // WHERE dinámico (parametrizado)
    const where = [];
    const params = [];

    if (dependencia) {
      params.push(`%${dependencia}%`);
      where.push(`dependencia ILIKE $${params.length}`);
    }
    if (trimestre) {
      params.push(`%${trimestre}%`);
      where.push(`trimestre ILIKE $${params.length}`);
    }

    // búsqueda general opcional (nombre / apellidos / curp / rusp / correo)
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(
        nombre ILIKE ${p}
        OR primer_apellido ILIKE ${p}
        OR segundo_apellido ILIKE ${p}
        OR curp ILIKE ${p}
        OR id_rusp ILIKE ${p}
        OR correo_institucional ILIKE ${p}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // total
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM registros_trimestral ${whereSql}`,
      params
    );
    const total = totalRes.rows?.[0]?.total ?? 0;

    // data paginada
    params.push(limit);
    params.push(offset);

    const dataSql = `
      SELECT *
      FROM registros_trimestral
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const result = await pool.query(dataSql, params);

    const pages = limit > 0 ? Math.ceil(total / limit) : 1;

    return res.status(200).json({
      success: true,
      page,
      limit,
      pages,
      total,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error /api/trimestral/list:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || String(error),
    });
  }
}
