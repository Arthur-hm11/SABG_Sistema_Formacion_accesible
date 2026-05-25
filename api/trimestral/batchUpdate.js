import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import { insertEstadoHistorial } from "../_lib/estadoHistorial.js";

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function isEnlaceRole(roleRaw) {
  const role = String(roleRaw || "").toLowerCase().trim();
  return role === "enlace" || role.startsWith("enlace");
}

function hasForbiddenHistoryField(value) {
  return /(historico|historial|history|estado_historico|cambios_historico)/i.test(String(value || ""));
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
  const isEnlace = isEnlaceRole(session?.rol);
  if (!isAdmin && !isEnlace) return res.status(403).json({ success: false, error: "No autorizado" });

  let client;
  try {
    const edits = req.body?.edits;
    if (!Array.isArray(edits) || edits.length === 0) {
      return res.status(400).json({ success: false, error: "Sin cambios" });
    }
    if (edits.length > 500) {
      return res.status(400).json({ success: false, error: "Máximo 500 cambios por guardado" });
    }

    if (Object.keys(req.body || {}).some(hasForbiddenHistoryField)) {
      return res.status(400).json({ success: false, error: "Payload no permitido" });
    }

    const ALLOWED = new Set([
      "nivel_educativo",
      "institucion_educativa",
      "modalidad",
      "estado_avance",
      "observaciones"
    ]);
    const ENLACE_ALLOWED = new Set(["observaciones"]);

    // La transaccion debe correr sobre el mismo cliente del pool.
    client = await pool.connect();
    await client.query("BEGIN");

    let updated = 0;
    for (const e of edits) {
      const id = Number(e?.id);
      const field = String(e?.field || "");
      const value = e?.value ?? null;

      if (!id || !ALLOWED.has(field) || hasForbiddenHistoryField(field)) continue;
      if (isEnlace && !ENLACE_ALLOWED.has(field)) continue;

      if (field === "estado_avance") {
        const currentRes = await client.query(
          `SELECT estado_avance, dependencia FROM public.registros_trimestral WHERE id = $1 LIMIT 1`,
          [id]
        );
        const current = currentRes.rows?.[0];
        if (!current) continue;
        const currentValue = String(current.estado_avance || "").trim();
        const nextValue = String(value || "").trim();
        if (!nextValue || currentValue === nextValue) continue;

        await client.query(`UPDATE public.registros_trimestral SET ${field} = $1 WHERE id = $2`, [value, id]);
        await insertEstadoHistorial(client, {
          registroId: id,
          estadoAnterior: currentValue || null,
          estadoNuevo: nextValue,
          motivo: String(e?.motivo || "ACTUALIZACIÓN ADMINISTRATIVA").trim().slice(0, 200),
          usuario: session.usuario || "SIN_USUARIO",
          rol: session.rol || null,
          dependencia: current.dependencia || null,
        });
        updated++;
        continue;
      }

      if (isEnlace) {
        const dependencia = norm(session?.dependencia);
        if (!dependencia) continue;
        const q = `
          UPDATE public.registros_trimestral
          SET ${field} = $1
          WHERE id = $2
            AND UPPER(BTRIM(dependencia)) = UPPER(BTRIM($3))
        `;
        const result = await client.query(q, [value, id, dependencia]);
        if (result.rowCount > 0) updated++;
        continue;
      }

      const q = `UPDATE public.registros_trimestral SET ${field} = $1 WHERE id = $2`;
      await client.query(q, [value, id]);
      updated++;
    }

    await client.query("COMMIT");
    return res.json({ success: true, updated });
  } catch (err) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch (_) {}
    console.error("Error /api/trimestral/batchUpdate:", err);
    return res.status(500).json({ success: false, error: "Error al guardar cambios" });
  } finally {
    client?.release();
  }
}
