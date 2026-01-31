const { requireAuth } = require("../_lib/auth");
const formidable = require("formidable");
const xlsx = require("xlsx");
const pool = require("../_lib/db.cjs");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function pickUploadedFile(files) {
  const f = files?.file;
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método no permitido" });
  }

  // Nota: formidable necesita bodyParser desactivado en Next.js,
  // pero aquí estamos en Vercel Functions (no Next). Funciona sin config extra.
  const form = formidable({
    maxFileSize: 15 * 1024 * 1024, // 15MB
    multiples: false,
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: "Error leyendo el archivo",
        error: err.message,
      });
    }

    const file = pickUploadedFile(files);
    if (!file?.filepath) {
      return res.status(400).json({
        success: false,
        message: "No se recibió archivo (campo esperado: file)",
      });
    }

    // Auth (cookies)
    const user = await requireAuth(req, res, pool);
    if (!user) return;

    let client;
    try {
      const workbook = xlsx.readFile(file.filepath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

      client = await pool.connect();

      // Inserción mínima (demo). Tu flujo real usa /api/trimestral/bulkCreate.
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
            row.observaciones ?? null,
          ]
        );
      }

      return res.status(200).json({
        success: true,
        message: "Excel cargado correctamente",
        inserted: rows.length,
      });
    } catch (e) {
      console.error("upload/excel error:", e);
      return res.status(500).json({
        success: false,
        message: "Error guardando en Neon",
        error: e.message,
      });
    } finally {
      if (client) client.release();
    }
  });
};
