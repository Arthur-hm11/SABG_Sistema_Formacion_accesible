import multer from "multer";
import { google } from "googleapis";
import stream from "stream";
import { applyCors } from "../_lib/cors.js";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const mime = String(file.mimetype || "").toLowerCase();

    // Must look like a PDF
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

export default async function handler(req, res) {
  // CORS allowlist
  const pre = applyCors(req, res);
  if (pre) return;

  // SECURITY: require session cookie
  const cookie = String(req.headers.cookie || "");
  if (!cookie.includes("sabg_session=")) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).send("Method Not Allowed");
  }

  try {
    await runMiddleware(req, res, upload.single("pdf"));

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "Missing pdf file (field name: pdf)",
      });
    }

    // Extra hardening: magic bytes
    if (!isPdfMagic(req.file.buffer)) {
      return res.status(415).json({
        ok: false,
        error: "Invalid PDF (magic bytes check failed)",
      });
    }

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

    return res.json({
      ok: true,
      fileId: uploadRes.data.id,
      link: uploadRes.data.webViewLink,
      name: safeName,
    });
  } catch (e) {
    // Multer size limit
    if (e && e.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        ok: false,
        error: `File too large. Max ${(MAX_BYTES / (1024 * 1024)).toFixed(0)}MB`,
      });
    }
    // FileFilter rejection
    if (e && e.code === "ONLY_PDF") {
      return res.status(415).json({ ok: false, error: "Only PDF files are allowed" });
    }

    console.error("UPLOAD ERROR:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
