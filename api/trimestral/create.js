import pool from "../_lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    const data = req.body || {};

    // Validar datos requeridos (mínimos)
    if (!data.enlace_nombre || !data.trimestre || !data.nombre) {
      return res.status(400).json({ success: false, error: "Faltan datos requeridos" });
    }

    const result = await pool.query(
      `INSERT INTO registros_trimestral (
        enlace_nombre, enlace_primer_apellido, enlace_segundo_apellido,
        enlace_correo, enlace_telefono, trimestre, id_rusp,
        primer_apellido, segundo_apellido, nombre, curp,
        nivel_puesto, nivel_tabular, ramo_ur, dependencia,
        correo_institucional, telefono_institucional,
        nivel_educativo, institucion_educativa, modalidad,
        estado_avance, observaciones, usuario_registro
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *`,
      [
        data.enlace_nombre ?? null,
        data.enlace_primer_apellido ?? null,
        data.enlace_segundo_apellido ?? null,
        data.enlace_correo ?? null,
        data.enlace_telefono ?? null,
        data.trimestre ?? null,
        data.id_rusp ?? null,
        data.primer_apellido ?? null,
        data.segundo_apellido ?? null,
        data.nombre ?? null,
        data.curp ?? null,
        data.nivel_puesto ?? null,
        data.nivel_tabular ?? null,
        data.ramo_ur ?? null,
        data.dependencia ?? null,
        data.correo_institucional ?? null,
        data.telefono_institucional ?? null,
        data.nivel_educativo ?? null,
        data.institucion_educativa ?? null,
        data.modalidad ?? null,
        data.estado_avance ?? null,
        data.observaciones ?? null,
        data.usuario_registro ?? null,
      ]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Error /api/trimestral/create:", error);
    return res.status(500).json({ success: false, error: error?.message || String(error) });
  }
}
