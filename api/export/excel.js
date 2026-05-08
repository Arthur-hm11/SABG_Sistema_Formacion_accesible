import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import ExcelJS from "exceljs";

async function buildWorkbook(headers = [], rows = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SABG";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet("Registros", {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));

  worksheet.columns = headers.map((header, index) => {
    const values = rows.map((row) => String(row[index] ?? ""));
    const maxLen = Math.max(String(header ?? "").length, ...values.map((value) => value.length), 12);
    return {
      header,
      key: `col_${index}`,
      width: Math.min(maxLen + 3, 42)
    };
  });

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "7A2F4D" }
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "C7B8C0" } },
      left: { style: "thin", color: { argb: "C7B8C0" } },
      bottom: { style: "thin", color: { argb: "C7B8C0" } },
      right: { style: "thin", color: { argb: "C7B8C0" } }
    };
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.eachCell((cell, colNumber) => {
      cell.alignment = {
        vertical: "top",
        horizontal: colNumber <= 2 ? "center" : "left",
        wrapText: true
      };
      cell.border = {
        top: { style: "thin", color: { argb: "E6DDE2" } },
        left: { style: "thin", color: { argb: "E6DDE2" } },
        bottom: { style: "thin", color: { argb: "E6DDE2" } },
        right: { style: "thin", color: { argb: "E6DDE2" } }
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: rowNumber % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF" }
      };
    });
  });

  const maybeWideColumns = new Set([
    "DEPENDENCIA",
    "INSTITUCIÓN EDUCATIVA",
    "MODALIDAD",
    "OBSERVACIONES",
    "ESTADO DE AVANCE"
  ]);

  headers.forEach((header, index) => {
    if (maybeWideColumns.has(header)) {
      worksheet.getColumn(index + 1).width = Math.max(worksheet.getColumn(index + 1).width || 18, 28);
    }
  });

  return workbook.xlsx.writeBuffer();
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

      const workbookBuffer = await buildWorkbook(headers, rows);
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

      const workbookBuffer = await buildWorkbook(headers, rows);
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
