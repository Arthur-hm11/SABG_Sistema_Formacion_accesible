import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import { ensureRegistrosTrimestralSchema } from "../_lib/registrosSchema.js";

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

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ success:false, error:"Unauthorized" });

  try {
    // Params
    const page = Math.max(1, toInt(req.query?.page, 1));
    const limitRaw = toInt(req.query?.limit, 200);     // default 200 (para que tu HTML no sufra)
    const limit = Math.min(500, Math.max(1, limitRaw)); // tope 500 para no reventar Vercel
    const offset = (page - 1) * limit;

    const dependencia = cleanLike(req.query?.dependencia);
    const trimestre = cleanLike(req.query?.trimestre);
    const anio = cleanLike(req.query?.anio);
    const q = cleanLike(req.query?.q);

    // WHERE dinámico (parametrizado)
    const where = [];
    const params = [];
    const isAdmin = isAdminSession(session);
    const sessionDependencia = cleanLike(session.dependencia);

    if (!isAdmin) {
      if (!sessionDependencia) {
        return res.status(403).json({ success: false, error: "Dependencia no autorizada" });
      }
      params.push(sessionDependencia);
      where.push(`UPPER(BTRIM(dependencia)) = UPPER(BTRIM($${params.length}))`);
    }

    if (dependencia) {
      params.push(`%${dependencia}%`);
      where.push(`dependencia ILIKE $${params.length}`);
    }
    if (trimestre) {
      params.push(`%${trimestre}%`);
      where.push(`trimestre ILIKE $${params.length}`);
    }
    if (anio) {
      params.push(anio);
      where.push(`BTRIM(anio) = BTRIM($${params.length})`);
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
        OR dependencia ILIKE ${p}
        OR correo_institucional ILIKE ${p}
        OR nombre_completo ILIKE ${p}
        OR sexo ILIKE ${p}
        OR persona_reportada_por ILIKE ${p}
        OR reporte_institucion_educativa ILIKE ${p}
        OR ruta_2026 ILIKE ${p}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    await ensureRegistrosTrimestralSchema(pool);

    const scopeWhere = [];
    const scopeParams = [];
    if (!isAdmin) {
      scopeParams.push(sessionDependencia);
      scopeWhere.push(`UPPER(BTRIM(dependencia)) = UPPER(BTRIM($${scopeParams.length}))`);
    }
    scopeWhere.push(`anio IS NOT NULL`);
    scopeWhere.push(`BTRIM(anio) <> ''`);
    const scopeWhereSql = `WHERE ${scopeWhere.join(" AND ")}`;

    const yearsRes = await pool.query(
      `
        SELECT DISTINCT anio
        FROM registros_trimestral
        ${scopeWhereSql}
        ORDER BY anio DESC
      `,
      scopeParams
    );
    const availableYears = (yearsRes.rows || []).map((row) => String(row.anio || "").trim()).filter(Boolean);

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
      availableYears,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error /api/trimestral/list:", error);
    return res.status(500).json({
      success: false,
      error: "Error al consultar registros",
    });
  }
}
