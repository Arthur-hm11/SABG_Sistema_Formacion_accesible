import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import { ESTADOS_AVANCE_VALIDOS, insertEstadoHistorial } from "../_lib/estadoHistorial.js";

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ success: false, error: "Unauthorized" });

  const isAdmin = isAdminSession(session);
  const registroId = Number(req.body?.id);
  const nuevoEstado = norm(req.body?.estado_avance);
  const motivo = norm(req.body?.motivo);

  if (!registroId || !nuevoEstado) {
    return res.status(400).json({ success: false, error: "Datos incompletos" });
  }

  if (!ESTADOS_AVANCE_VALIDOS.has(nuevoEstado)) {
    return res.status(400).json({ success: false, error: "Estado de avance inválido" });
  }

  if (!motivo) {
    return res.status(400).json({ success: false, error: "Debes capturar el motivo del cambio" });
  }

  if (motivo.length > 200) {
    return res.status(400).json({ success: false, error: "El motivo no puede exceder 200 caracteres" });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const params = [registroId];
    let whereExtra = "";

    if (!isAdmin) {
      const dependencia = norm(session.dependencia);
      if (!dependencia) {
        await client.query("ROLLBACK");
        return res.status(403).json({ success: false, error: "Dependencia no autorizada" });
      }
      params.push(dependencia);
      whereExtra = ` AND UPPER(BTRIM(dependencia)) = UPPER(BTRIM($2))`;
    }

    const registroRes = await client.query(
      `
        SELECT id, estado_avance, dependencia
        FROM public.registros_trimestral
        WHERE id = $1
        ${whereExtra}
        LIMIT 1
      `,
      params
    );

    if (!registroRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }

    const actual = norm(registroRes.rows[0].estado_avance);
    if (actual === nuevoEstado) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "El estado seleccionado ya es el vigente" });
    }

    await client.query(
      `
        UPDATE public.registros_trimestral
        SET estado_avance = $1
        WHERE id = $2
      `,
      [nuevoEstado, registroId]
    );

    await insertEstadoHistorial(client, {
      registroId,
      estadoAnterior: actual,
      estadoNuevo: nuevoEstado,
      motivo,
      usuario: session.usuario || "SIN_USUARIO",
      rol: session.rol || null,
      dependencia: registroRes.rows[0].dependencia || session.dependencia || null,
    });

    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      message: "Estado actualizado correctamente",
      data: {
        id: registroId,
        estado_anterior: actual,
        estado_avance: nuevoEstado,
        motivo,
      },
    });
  } catch (error) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch (_) {}
    console.error("Error /api/trimestral/updateEstado:", error);
    return res.status(500).json({ success: false, error: "Error al actualizar estado de avance" });
  } finally {
    client?.release();
  }
}

