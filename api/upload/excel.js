import formidable from 'formidable';
import xlsx from 'xlsx';
import pool from '../_lib/db.js';
import { applyCors } from '../_lib/cors.js';
import { readSabgSession, isAdminSession } from '../_lib/session.js';

export const config = {
  api: { bodyParser: false }
};

function pickUploadedFile(files) {
  const f = files?.file;
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}


function normalizarEncabezado(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "N")
    .trim()
    .toLowerCase();
}

function normalizarFila(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    let nk = normalizarEncabezado(k);
    if (nk === "año" || nk == "ano" || nk == "a o" || nk == "a�o" || nk == "a?o") nk = "anio";
    out[nk] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método no permitido' });
  }

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!isAdminSession(session)) return res.status(403).json({ success: false, message: 'No autorizado' });

  const form = formidable({
    maxFileSize: 15 * 1024 * 1024, // 15MB
    multiples: false,
    keepExtensions: true
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: 'Error leyendo el archivo',
        error: err.message
      });
    }

    const file = pickUploadedFile(files);
    if (!file?.filepath) {
      return res.status(400).json({
        success: false,
        message: 'No se recibió archivo (campo esperado: file)'
      });
    }

    let client;
    try {
      const workbook = xlsx.readFile(file.filepath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

      client = await pool.connect();

      for (const row of rows) {
        await client.query(
          `
          INSERT INTO public.registros_trimestral
          (nombre, primer_apellido, segundo_apellido, curp, dependencia, observaciones)
          VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [
            row.nombre ?? null,
            row.primer_apellido ?? null,
            row.segundo_apellido ?? null,
            row.curp ?? null,
            row.dependencia ?? null,
            row.observaciones ?? null
          ]
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Excel cargado correctamente',
        inserted: rows.length
      });

    } catch (e) {
      console.error('upload/excel error:', e);
      return res.status(500).json({
        success: false,
        message: 'Error guardando archivo'
      });

    } finally {
      if (client) client.release();
    }
  });
}
