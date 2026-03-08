import multer from "multer";
import { google } from "googleapis";
import stream from "stream";
import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession } from "../_lib/session.js";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const mime = String(file.mimetype || "").toLowerCase();

    const okExt = name.endsWith(".pdf");
    const okMime = mime === "application/pdf" || mime === "application/x-pdf";

    if (!okExt || !okMime) {
      const err = new Error("Only PDF files are allowed");
      err.code = "ONLY_PDF";
      return cb(err);
    }
    return cb(null, true);
  },
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) =>
      result instanceof Error ? reject(result) : resolve(result)
    );
  });
}

function isPdfMagic(buf) {
  try {
    if (!buf || buf.length < 5) return false;
    return buf.subarray(0, 5).toString("utf8") === "%PDF-";
  } catch {
    return false;
  }
}

function cleanText(v) {
  return String(v ?? "").trim();
}

function parseMesAnio(rawMes) {
  const src = cleanText(rawMes);

  const meses = {
    enero: "Enero",
    febrero: "Febrero",
    marzo: "Marzo",
    abril: "Abril",
    mayo: "Mayo",
    junio: "Junio",
    julio: "Julio",
    agosto: "Agosto",
    septiembre: "Septiembre",
    setiembre: "Septiembre",
    octubre: "Octubre",
    noviembre: "Noviembre",
    diciembre: "Diciembre",
  };

  const now = new Date();
  let anio = now.getFullYear();
  let mes = "";

  const yearMatch = src.match(/\b(20\d{2})\b/);
  if (yearMatch) anio = parseInt(yearMatch[1], 10);

  const lower = src.toLowerCase();
  for (const [k, v] of Object.entries(meses)) {
    if (lower.includes(k)) {
      mes = v;
      break;
    }
  }

  if (!mes) {
    const nombres = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];
    mes = nombres[now.getMonth()];
  }

  return { mes, anio };
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).send("Method Not Allowed");
  }

  let uploadedFileId = null;

  try {
    await runMiddleware(req, res, upload.single("pdf"));

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "Missing pdf file (field name: pdf)",
      });
    }

    if (!isPdfMagic(req.file.buffer)) {
      return res.status(415).json({
        ok: false,
        error: "Invalid PDF (magic bytes check failed)",
      });
    }

    const nombre = cleanText(req.body?.nombre);
    const primerApellido = cleanText(req.body?.primerApellido);
    const segundoApellido = cleanText(req.body?.segundoApellido);
    const correo = cleanText(req.body?.correo).toLowerCase();
    const rawMes = cleanText(req.body?.mes);

    if (!nombre || !primerApellido || !segundoApellido || !correo) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios del enlace",
      });
    }

    const { mes, anio } = parseMesAnio(rawMes);

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const folderId = process.env.DRIVE_FOLDER_ID;

    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({ ok: false, error: "OAuth credentials missing" });
    }
    if (!folderId) {
      return res.status(500).json({ ok: false, error: "DRIVE_FOLDER_ID missing" });
    }

    let dependencia = String(session?.dependencia || "").trim();

    if (!dependencia) {
      const depRes = await pool.query(
        `
        SELECT
          r.dependencia
        FROM public.registros_trimestral r
        WHERE LOWER(BTRIM(COALESCE(r.enlace_correo, ''))) = LOWER(BTRIM($1))
        ORDER BY r.created_at DESC NULLS LAST, r.id DESC
        LIMIT 1
        `,
        [correo]
      );

      dependencia = depRes.rows?.[0]?.dependencia
        ? String(depRes.rows[0].dependencia).trim()
        : "";
    }

    if (!dependencia) {
      return res.status(400).json({
        ok: false,
        error: "No se encontró una dependencia vinculada al usuario o al correo institucional del enlace",
      });
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret, "http://localhost");
    auth.setCredentials({ refresh_token: refreshToken });

    const drive = google.drive({ version: "v3", auth });

    const safeName = (req.file.originalname || "evidencia.pdf")
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 140);

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const uploadRes = await drive.files.create({
      requestBody: {
        name: safeName,
        parents: [folderId],
        mimeType: "application/pdf",
      },
      media: {
        mimeType: "application/pdf",
        body: bufferStream,
      },
      fields: "id, webViewLink",
    });

    uploadedFileId = uploadRes?.data?.id || null;

    const pdfUrl = String(uploadRes?.data?.webViewLink || "").trim();

    await pool.query(
      `
      INSERT INTO public.evidencias_mensuales (
        mes,
        anio,
        enlace_nombre,
        enlace_primer_apellido,
        enlace_segundo_apellido,
        enlace_correo,
        archivo_pdf_url,
        archivo_pdf_nombre,
        dependencia,
        usuario_registro,
        estado_revision
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11
      )
      `,
      [
        mes,
        anio,
        nombre,
        primerApellido,
        segundoApellido,
        correo,
        pdfUrl || null,
        safeName,
        dependencia,
        String(session?.usuario || correo || ""),
        "Pendiente",
      ]
    );

    return res.json({
      ok: true,
      fileId: uploadedFileId,
      link: pdfUrl,
      name: safeName,
      dependencia,
      mes,
      anio,
    });
  } catch (e) {
    if (uploadedFileId) {
      try {
        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

        if (clientId && clientSecret && refreshToken) {
          const auth = new google.auth.OAuth2(clientId, clientSecret, "http://localhost");
          auth.setCredentials({ refresh_token: refreshToken });
          const drive = google.drive({ version: "v3", auth });
          await drive.files.delete({ fileId: uploadedFileId });
        }
      } catch (cleanupErr) {
        console.error("CLEANUP DRIVE ERROR:", cleanupErr);
      }
    }

    if (e && e.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        ok: false,
        error: `File too large. Max ${(MAX_BYTES / (1024 * 1024)).toFixed(0)}MB`,
      });
    }

    if (e && e.code === "ONLY_PDF") {
      return res.status(415).json({ ok: false, error: "Only PDF files are allowed" });
    }

    console.error("UPLOAD ERROR:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
