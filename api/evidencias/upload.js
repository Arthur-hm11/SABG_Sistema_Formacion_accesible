import multer from "multer";
import { google } from "googleapis";
import stream from "stream";

const upload = multer({ storage: multer.memoryStorage() });

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) =>
      result instanceof Error ? reject(result) : resolve(result)
    );
  });
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const folderId = process.env.DRIVE_FOLDER_ID;

    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({
        ok: false,
        error: "OAuth credentials missing",
      });
    }

    const auth = new google.auth.OAuth2(
      clientId,
      clientSecret,
      "http://localhost"
    );

    auth.setCredentials({
      refresh_token: refreshToken,
    });

    const drive = google.drive({
      version: "v3",
      auth,
    });

    const safeName = (req.file.originalname || "evidencia.pdf")
      .replace(/[^\w.\-]+/g, "_");

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const uploadRes = await drive.files.create({

      requestBody: {
        name: safeName,
        parents: folderId ? [folderId] : undefined,
        mimeType: req.file.mimetype || "application/pdf",
      },

      media: {
        mimeType: req.file.mimetype || "application/pdf",
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

    console.error("UPLOAD ERROR:", e);

    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
    });

  }
}

