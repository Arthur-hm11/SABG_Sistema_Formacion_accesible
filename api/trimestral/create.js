import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import { logAuditEvent } from "../_lib/monitoring.js";

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function upperOrNull(v) {
  const s = norm(v);
  return s ? s.toUpperCase() : null;
}

function clip(v, max) {
  const s = norm(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// CURP seguro (varchar 18)
function normalizeCurpForDb(curpVal) {
  const s = upperOrNull(curpVal);
  if (!s) return null;

  const bad = new Set([
    "SIN CURP",
    "S/CURP",
    "SIN INFORMACION",
    "SIN INFORMACIÓN",
    "NO CUENTA CON CURP",
    "N/A",
    "NO APLICA",
    "NA",
    "NULL",
    "-",
    "0",
  ]);
  if (bad.has(s)) return null;

  const compact = s.replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 18) return null;
  if (!/^[A-Z0-9]{18}$/.test(compact)) return null;

  return compact;
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
  if (!session) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const data = req.body || {};
    const isAdmin = isAdminSession(session);
    if (!isAdmin) {
      if (!norm(session.dependencia)) {
        return res.status(403).json({ success: false, error: "Dependencia no autorizada" });
      }
      const requestedDependencia = norm(data.dependencia);
      if (requestedDependencia && requestedDependencia !== session.dependencia) {
        return res.status(403).json({ success: false, error: "Solo puedes registrar información de tu dependencia" });
      }
      data.dependencia = session.dependencia;
      data.usuario_registro = session.usuario || data.usuario_registro;
    }

    // Validar datos requeridos mínimos
    if (!norm(data.enlace_nombre) || !norm(data.anio) || !norm(data.trimestre) || !norm(data.nombre)) {
      return res.status(400).json({ success: false, error: "Faltan datos requeridos" });
    }

    const curpClean = normalizeCurpForDb(data.curp);

    // Si viene CURP válida, revisar si ya existe
    if (curpClean) {
      const existe = await pool.query(
        `
          SELECT id
          FROM registros_trimestral
          WHERE UPPER(BTRIM(curp)) = $1
          LIMIT 1
        `,
        [curpClean]
      );

      if (existe.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: "La persona ya está registrada."
        });
      }
    }

    const values = [
      clip(data.enlace_nombre, 200),
      clip(data.enlace_primer_apellido, 100),
      clip(data.enlace_segundo_apellido, 100),
      clip(data.enlace_correo, 200),
      clip(data.enlace_telefono, 50),
      clip(String(data.anio ?? ""), 4),
      clip(data.trimestre, 50),
      clip(data.id_rusp, 100),
      clip(data.primer_apellido, 100),
      clip(data.segundo_apellido, 100),
      clip(data.nombre, 200),
      curpClean,
      clip(data.nivel_puesto, 200),
      clip(data.nivel_tabular, 50),
      clip(data.ramo_ur, 50),
      norm(data.dependencia),
      clip(data.correo_institucional, 200),
      clip(data.telefono_institucional, 50),
      clip(data.nivel_educativo, 100),
      norm(data.institucion_educativa),
      norm(data.modalidad),
      norm(data.estado_avance),
      norm(data.observaciones),
      clip(data.usuario_registro, 100),
    ];

    const result = await pool.query(
      `INSERT INTO registros_trimestral (
        enlace_nombre, enlace_primer_apellido, enlace_segundo_apellido,
        enlace_correo, enlace_telefono, anio, trimestre, id_rusp,
        primer_apellido, segundo_apellido, nombre, curp,
        nivel_puesto, nivel_tabular, ramo_ur, dependencia,
        correo_institucional, telefono_institucional,
        nivel_educativo, institucion_educativa, modalidad,
        estado_avance, observaciones, usuario_registro
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING *`,
      values
    );

    try {
      await logAuditEvent({
        usuario: session.usuario || data.usuario_registro || "SIN_USUARIO",
        accion: "REGISTRO_TRIMESTRAL_CREATE",
        modulo: "trimestral",
        detalle: {
          registro_id: result.rows?.[0]?.id || null,
          persona: {
            nombre: clip(data.nombre, 200),
            primer_apellido: clip(data.primer_apellido, 100),
            segundo_apellido: clip(data.segundo_apellido, 100),
          },
          curp: curpClean ? `${String(curpClean).slice(0, 4)}**********${String(curpClean).slice(-4)}` : null,
          dependencia: norm(data.dependencia),
          trimestre: clip(data.trimestre, 50),
          anio: clip(String(data.anio ?? ""), 4),
          cuenta_registro: session.usuario || data.usuario_registro || null,
        },
        ip: req.headers["x-forwarded-for"]?.toString().split(",")[0],
        userAgent: req.headers["user-agent"],
      });
    } catch (_) {
      // El monitoreo no debe romper el registro productivo
    }

    return res.status(201).json({
      success: true,
      message: "Registro guardado correctamente.",
      data: result.rows[0]
    });
  } catch (error) {
    // Respaldo por si entra el índice único y llega un duplicado simultáneo
    if (error?.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "La persona ya está registrada."
      });
    }

    console.error("Error /api/trimestral/create:", error);
    return res.status(500).json({
      success: false,
      error: "Error al guardar registro"
    });
  }
}
