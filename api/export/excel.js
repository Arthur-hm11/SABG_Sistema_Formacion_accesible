import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import XLSX from "xlsx";

function buildWorkbook(headers = [], rows = []) {
  const aoa = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  worksheet["!cols"] = headers.map((header, index) => {
    const values = rows.map((row) => String(row[index] ?? ""));
    const maxLen = Math.max(String(header ?? "").length, ...values.map((value) => value.length), 12);
    return { wch: Math.min(maxLen + 2, 48) };
  });

  if (headers.length) {
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { c: 0, r: 0 },
        e: { c: headers.length - 1, r: Math.max(rows.length, 1) }
      })
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Registros");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export default async (req, res) => {
  const pre = applyCors(req, res);
  if (pre) return;
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdminSession(session)) return res.status(403).json({ error: 'No autorizado' });

  const { format = 'json' } = req.query;
  const today = new Date().toISOString().split('T')[0];

  if (req.method === 'POST') {
    try {
      const headers = Array.isArray(req.body?.headers) ? req.body.headers.map((value) => String(value ?? '')) : [];
      const rows = Array.isArray(req.body?.rows)
        ? req.body.rows.map((row) => Array.isArray(row) ? row.map((value) => String(value ?? '')) : [])
        : [];

      if (!headers.length) {
        return res.status(400).json({ error: 'No se recibieron encabezados para exportar' });
      }

      const workbookBuffer = buildWorkbook(headers, rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=registros_sabg_${today}.xlsx`);
      return res.status(200).send(workbookBuffer);
    } catch (error) {
      console.error('Error al exportar XLSX:', error);
      return res.status(500).json({ error: 'Error al exportar XLSX' });
    }
  }

  try {
    const result = await pool.query(`
      SELECT * FROM registros_trimestral
      ORDER BY created_at DESC
    `);

    if (format === 'csv') {
      // Generar CSV
      const headers = Object.keys(result.rows[0] || {});
      let csv = headers.join(',') + '\n';
      
      result.rows.forEach(row => {
        const values = headers.map(header => {
          const value = row[header];
          if (value === null || value === undefined) return '';
          const stringValue = String(value).replace(/"/g, '""');
          return `"${stringValue}"`;
        });
        csv += values.join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=registros_sabg_${today}.csv`);
      return res.status(200).send(csv);
    } else if (format === 'xlsx' || format === 'excel') {
      const headers = [
        'N°',
        'TRIMESTRE',
        'ID RUSP',
        'PRIMER APELLIDO',
        'SEGUNDO APELLIDO',
        'NOMBRE(S)',
        'CURP',
        'NIVEL DE PUESTO',
        'NIVEL TABULAR',
        'RAMO - UR',
        'DEPENDENCIA',
        'CORREO INSTITUCIONAL',
        'TELÉFONO',
        'NIVEL EDUCATIVO',
        'INSTITUCIÓN EDUCATIVA',
        'MODALIDAD',
        'ESTADO DE AVANCE',
        'OBSERVACIONES',
        'ENLACE NOMBRE(S)',
        'ENLACE PRIMER APELLIDO',
        'ENLACE SEGUNDO APELLIDO',
        'ENLACE CORREO',
        'ENLACE TELÉFONO',
        'FECHA REGISTRO'
      ];

      const rows = result.rows.map((row, index) => ([
        index + 1,
        row.trimestre || '',
        row.id_rusp || '',
        row.primer_apellido || '',
        row.segundo_apellido || '',
        row.nombre || '',
        row.curp || '',
        row.nivel_puesto || '',
        row.nivel_tabular || '',
        row.ramo_ur || '',
        row.dependencia || '',
        row.correo_institucional || '',
        row.telefono_institucional || '',
        row.nivel_educativo || '',
        row.institucion_educativa || '',
        row.modalidad || '',
        row.estado_avance || '',
        row.observaciones || '',
        row.enlace_nombre || '',
        row.enlace_primer_apellido || '',
        row.enlace_segundo_apellido || '',
        row.enlace_correo || '',
        row.enlace_telefono || '',
        row.created_at || ''
      ]));

      const workbookBuffer = buildWorkbook(headers, rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=registros_sabg_${today}.xlsx`);
      return res.status(200).send(workbookBuffer);
    } else {
      // Generar JSON para Excel (formato compatible)
      const data = result.rows.map((row, index) => ({
        'N°': index + 1,
        'TRIMESTRE': row.trimestre || '',
        'ID RUSP': row.id_rusp || '',
        'PRIMER APELLIDO': row.primer_apellido || '',
        'SEGUNDO APELLIDO': row.segundo_apellido || '',
        'NOMBRE(S)': row.nombre || '',
        'CURP': row.curp || '',
        'NIVEL DE PUESTO': row.nivel_puesto || '',
        'NIVEL TABULAR': row.nivel_tabular || '',
        'RAMO - UR': row.ramo_ur || '',
        'DEPENDENCIA': row.dependencia || '',
        'CORREO INSTITUCIONAL': row.correo_institucional || '',
        'TELÉFONO': row.telefono_institucional || '',
        'NIVEL EDUCATIVO': row.nivel_educativo || '',
        'INSTITUCIÓN EDUCATIVA': row.institucion_educativa || '',
        'MODALIDAD': row.modalidad || '',
        'ESTADO DE AVANCE': row.estado_avance || '',
        'OBSERVACIONES': row.observaciones || '',
        'ENLACE NOMBRE(S)': row.enlace_nombre || '',
        'ENLACE PRIMER APELLIDO': row.enlace_primer_apellido || '',
        'ENLACE SEGUNDO APELLIDO': row.enlace_segundo_apellido || '',
        'ENLACE CORREO': row.enlace_correo || '',
        'ENLACE TELÉFONO': row.enlace_telefono || '',
        'FECHA REGISTRO': row.created_at || ''
      }));

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=registros_sabg_${today}.json`);
      return res.status(200).json(data);
    }

  } catch (error) {
    console.error('Error al exportar:', error);
    return res.status(500).json({ error: 'Error al exportar' });
  }
};
