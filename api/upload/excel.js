const { requireAuth } = require("../_lib/auth");
import formidable from 'formidable';
import xlsx from 'xlsx';
import pool from '../_lib/db.js';

export const config = {
  api: { bodyParser: false }
};

function pickUploadedFile(files) {
  const f = files?.file;
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método no permitido' });
  }

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
        message: 'Error guardando en Neon',
        error: e.message
      });

    } finally {
      if (client) client.release();
    }
  });
}
