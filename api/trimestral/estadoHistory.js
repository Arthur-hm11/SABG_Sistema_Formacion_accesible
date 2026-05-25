import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import { ensureEstadoHistorialTable } from "../_lib/estadoHistorial.js";

function cleanLike(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ success: false, error: "Unauthorized" });

  const registroId = Number(req.query?.id);
  if (!registroId) {
    return res.status(400).json({ success: false, error: "Registro inválido" });
  }

  try {
    const isAdmin = isAdminSession(session);
    const params = [registroId];
    let whereExtra = "";

    if (!isAdmin) {
      const dep = cleanLike(session.dependencia);
      if (!dep) {
        return res.status(403).json({ success: false, error: "Dependencia no autorizada" });
      }
      params.push(dep);
      whereExtra = ` AND UPPER(BTRIM(dependencia)) = UPPER(BTRIM($2))`;
    }

    const registroRes = await pool.query(
      `
        SELECT
          id,
          estado_avance,
          usuario_registro,
          dependencia,
          created_at
        FROM public.registros_trimestral
        WHERE id = $1
        ${whereExtra}
        LIMIT 1
      `,
      params
    );

    if (!registroRes.rows.length) {
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }

    await ensureEstadoHistorialTable(pool);

    const historyRes = await pool.query(
      `
        SELECT
          id,
          registro_id,
          estado_anterior,
          estado_nuevo,
          motivo,
          usuario,
          rol,
          dependencia,
          changed_at
        FROM public.registros_trimestral_estado_historial
        WHERE registro_id = $1
        ORDER BY changed_at DESC, id DESC
      `,
      [registroId]
    );

    let items = historyRes.rows;
    if (!items.length) {
      const registro = registroRes.rows[0];
      items = [{
        id: null,
        registro_id: registro.id,
        estado_anterior: null,
        estado_nuevo: registro.estado_avance || null,
        motivo: "ESTADO REGISTRADO ANTES DE HABILITAR EL HISTÓRICO",
        usuario: registro.usuario_registro || null,
        rol: null,
        dependencia: registro.dependencia || null,
        changed_at: registro.created_at || null,
      }];
    }

    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    console.error("Error /api/trimestral/estadoHistory:", error);
    return res.status(500).json({ success: false, error: "Error al consultar histórico" });
  }
}

