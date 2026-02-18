import formidable from 'formidable';
import xlsx from 'xlsx';
import { Pool } from 'pg';

export const config = {
  api: { bodyParser: false }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ message: 'Error leyendo el archivo' });
    }

    try {
      const workbook = xlsx.readFile(files.file.filepath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet);

      const client = await pool.connect();

      for (const row of rows) {
        await client.query(`
          INSERT INTO public.registros_trimestral
          (nombre, primer_apellido, segundo_apellido, curp, dependencia, observaciones)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [
          row.nombre,
          row.primer_apellido,
          row.segundo_apellido,
          row.curp,
          row.dependencia,
          row.observaciones || null
        ]);
      }

      client.release();
      res.json({ message: 'Excel cargado correctamente' });

    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Error guardando en Neon' });
    }
  });
}
