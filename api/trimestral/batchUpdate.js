import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession, isSuperAdminSession } from "../_lib/session.js";
import { insertEstadoHistorial } from "../_lib/estadoHistorial.js";
import { normalizeExtendedFields } from "../_lib/registrosSchema.js";

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

const SYNCED_ROUTE_FIELDS = new Set([
  "nivel_educativo",
  "reporte_institucion_educativa",
  "ruta_2026",
]);

const SYNCED_PERIODO_FIELDS = new Set([
  "periodo_ruta",
  "anio",
  "trimestre",
]);

const SYNCED_NOMBRE_FIELDS = new Set([
  "primer_apellido",
  "segundo_apellido",
  "nombre",
  "nombre_completo",
]);

const NORMALIZED_SIMPLE_FIELDS = new Set([
  "sexo",
  "persona_reportada_por",
]);

const SUPERADMIN_ALLOWED = new Set([
  "periodo_ruta",
  "anio",
  "trimestre",
  "id_rusp",
  "primer_apellido",
  "segundo_apellido",
  "nombre",
  "nombre_completo",
  "sexo",
  "curp",
  "nivel_puesto",
  "nivel_tabular",
  "ramo_ur",
  "dependencia",
  "correo_institucional",
  "telefono_institucional",
  "nivel_educativo",
  "institucion_educativa",
  "modalidad",
  "estado_avance",
  "observaciones",
  "persona_reportada_por",
  "reporte_institucion_educativa",
  "ruta_2026",
  "enlace_nombre",
  "enlace_primer_apellido",
  "enlace_segundo_apellido",
  "enlace_correo",
  "enlace_telefono",
]);

const ADMIN_ALLOWED = new Set([
  "estado_avance",
  "observaciones",
  "reporte_institucion_educativa",
  "ruta_2026",
]);

const ENLACE_ALLOWED = new Set([
  "observaciones",
]);

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
  const isSuperadmin = isSuperAdminSession(session);
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

    const allowedFields = isSuperadmin
      ? SUPERADMIN_ALLOWED
      : (isEnlace ? ENLACE_ALLOWED : ADMIN_ALLOWED);

    client = await pool.connect();
    await client.query("BEGIN");

    let updated = 0;
    for (const e of edits) {
      const id = Number(e?.id);
      const field = String(e?.field || "");
      const value = e?.value ?? null;

      if (!id || !allowedFields.has(field) || hasForbiddenHistoryField(field)) continue;

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

      if (isSuperadmin && SYNCED_PERIODO_FIELDS.has(field)) {
        const currentRes = await client.query(
          `
            SELECT anio, trimestre, periodo_ruta
            FROM public.registros_trimestral
            WHERE id = $1
            LIMIT 1
          `,
          [id]
        );
        const current = currentRes.rows?.[0];
        if (!current) continue;

        const nextRow = { ...current, [field]: value };
        const normalized = normalizeExtendedFields(nextRow);
        const result = await client.query(
          `
            UPDATE public.registros_trimestral
            SET anio = $1,
                trimestre = $2,
                periodo_ruta = $3
            WHERE id = $4
          `,
          [
            nextRow.anio ?? current.anio ?? null,
            nextRow.trimestre ?? current.trimestre ?? null,
            normalized.periodo_ruta,
            id,
          ]
        );
        if (result.rowCount > 0) updated++;
        continue;
      }

      if (isSuperadmin && SYNCED_NOMBRE_FIELDS.has(field)) {
        const currentRes = await client.query(
          `
            SELECT primer_apellido, segundo_apellido, nombre, nombre_completo
            FROM public.registros_trimestral
            WHERE id = $1
            LIMIT 1
          `,
          [id]
        );
        const current = currentRes.rows?.[0];
        if (!current) continue;

        const nextRow = { ...current, [field]: value };
        const normalized = normalizeExtendedFields(nextRow);
        const result = await client.query(
          `
            UPDATE public.registros_trimestral
            SET primer_apellido = $1,
                segundo_apellido = $2,
                nombre = $3,
                nombre_completo = $4
            WHERE id = $5
          `,
          [
            nextRow.primer_apellido ?? current.primer_apellido ?? null,
            nextRow.segundo_apellido ?? current.segundo_apellido ?? null,
            nextRow.nombre ?? current.nombre ?? null,
            normalized.nombre_completo,
            id,
          ]
        );
        if (result.rowCount > 0) updated++;
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

      if (isSuperadmin && NORMALIZED_SIMPLE_FIELDS.has(field)) {
        const currentRes = await client.query(
          `
            SELECT sexo, persona_reportada_por
            FROM public.registros_trimestral
            WHERE id = $1
            LIMIT 1
          `,
          [id]
        );
        const current = currentRes.rows?.[0];
        if (!current) continue;

        const nextRow = { ...current, [field]: value };
        const normalized = normalizeExtendedFields(nextRow);
        const result = await client.query(
          `
            UPDATE public.registros_trimestral
            SET sexo = $1,
                persona_reportada_por = $2
            WHERE id = $3
          `,
          [
            normalized.sexo,
            normalized.persona_reportada_por,
            id,
          ]
        );
        if (result.rowCount > 0) updated++;
        continue;
      }

      if (SYNCED_ROUTE_FIELDS.has(field)) {
        const currentRes = await client.query(
          `
            SELECT nivel_educativo, reporte_institucion_educativa, ruta_2026
            FROM public.registros_trimestral
            WHERE id = $1
            LIMIT 1
          `,
          [id]
        );
        const current = currentRes.rows?.[0];
        if (!current) continue;

        const nextRow = { ...current, [field]: value };
        if (field === "reporte_institucion_educativa" || field === "nivel_educativo") {
          nextRow.ruta_2026 = null;
        }
        if (field === "ruta_2026") {
          nextRow.reporte_institucion_educativa = null;
        }

        const normalized = normalizeExtendedFields(nextRow);
        const result = await client.query(
          `
            UPDATE public.registros_trimestral
            SET nivel_educativo = $1,
                reporte_institucion_educativa = $2,
                ruta_2026 = $3
            WHERE id = $4
          `,
          [
            nextRow.nivel_educativo ?? current.nivel_educativo ?? null,
            normalized.reporte_institucion_educativa,
            normalized.ruta_2026,
            id,
          ]
        );
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
