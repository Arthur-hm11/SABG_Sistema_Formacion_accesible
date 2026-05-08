import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import ExcelJS from "exceljs";

const WIDTH_OVERRIDES = {
  "N°": 8,
  "AÑO": 10,
  "TRIMESTRE": 18,
  "ID RUSP": 18,
  "PRIMER APELLIDO": 22,
  "SEGUNDO APELLIDO": 22,
  "NOMBRE(S)": 24,
  "CURP": 22,
  "NIVEL DE PUESTO": 28,
  "NIVEL TABULAR": 16,
  "RAMO - UR": 16,
  "DEPENDENCIA": 30,
  "CORREO INSTITUCIONAL": 34,
  "TELÉFONO": 22,
  "NIVEL EDUCATIVO": 18,
  "INSTITUCIÓN EDUCATIVA": 40,
  "MODALIDAD": 28,
  "ESTADO DE AVANCE": 32,
  "OBSERVACIONES": 54,
  "ENLACE NOMBRE(S)": 24,
  "ENLACE PRIMER APELLIDO": 22,
  "ENLACE SEGUNDO APELLIDO": 22,
  "ENLACE CORREO": 34,
  "ENLACE TELÉFONO": 22,
  "FECHA REGISTRO": 22
};

const NUMERIC_HEADERS = new Set(["N°", "AÑO"]);
const PHONE_HEADERS = new Set(["TELÉFONO", "ENLACE TELÉFONO"]);

function normalizeHeader(header) {
  return String(header ?? "").trim().toUpperCase();
}

function normalizeCellValue(header, rawValue) {
  if (rawValue === null || rawValue === undefined) return "";

  const value = String(rawValue).trim();
  if (!value) return "";

  const normalizedHeader = normalizeHeader(header);

  if (NUMERIC_HEADERS.has(normalizedHeader) && /^\d+$/.test(value)) {
    return Number(value);
  }

  if (PHONE_HEADERS.has(normalizedHeader) && /^\d{7,15}$/.test(value)) {
    return Number(value);
  }

  return value;
}

async function buildWorkbook(headers = [], rows = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SABG";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Exportación de registros SABG";
  workbook.title = "Registros SABG";

  const worksheet = workbook.addWorksheet("Registros", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  worksheet.properties.defaultRowHeight = 22;
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0
  };

  worksheet.addRow(headers);
  rows.forEach((row) => {
    const normalizedRow = headers.map((header, index) => normalizeCellValue(header, row[index]));
    worksheet.addRow(normalizedRow);
  });

  worksheet.columns = headers.map((header, index) => {
    const values = rows.map((row) => String(row[index] ?? ""));
    const maxLen = Math.max(String(header ?? "").length, ...values.map((value) => value.length), 12);
    return {
      header,
      key: `col_${index}`,
      width: WIDTH_OVERRIDES[normalizeHeader(header)] || Math.min(maxLen + 3, 42)
    };
  });

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "7A2F4D" }
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "C7B8C0" } },
      left: { style: "thin", color: { argb: "C7B8C0" } },
      bottom: { style: "medium", color: { argb: "5E213B" } },
      right: { style: "thin", color: { argb: "C7B8C0" } }
    };
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.height = 22;

    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1];
      const normalizedHeader = normalizeHeader(header);
      const isShortCentered = new Set(["N°", "AÑO", "TRIMESTRE", "NIVEL TABULAR", "RAMO - UR"]).has(normalizedHeader);

      cell.alignment = {
        vertical: "top",
        horizontal: isShortCentered ? "center" : "left",
        wrapText: true
      };
      cell.font = { size: 10, name: "Calibri", color: { argb: "FF2E2E2E" } };
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

      if (NUMERIC_HEADERS.has(normalizedHeader) || PHONE_HEADERS.has(normalizedHeader)) {
        cell.numFmt = "0";
      }
    });
  });

  worksheet.getRow(1).eachCell((cell) => {
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
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
