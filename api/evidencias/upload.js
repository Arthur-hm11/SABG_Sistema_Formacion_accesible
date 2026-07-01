import multer from "multer";
import { google } from "googleapis";
import stream from "stream";
import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession } from "../_lib/session.js";
import { logAuditEvent } from "../_lib/monitoring.js";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const MESES_EVIDENCIA = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const EVIDENCE_HOLIDAYS = [];

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

function clean(value, max = 250) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanEnv(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getMexicoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value || new Date().getFullYear());
  const monthIndex = Number(parts.find((part) => part.type === "month")?.value || 1) - 1;
  const day = Number(parts.find((part) => part.type === "day")?.value || 1);
  return { year, monthIndex, day };
}

function createCalendarDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
}

function datePartsFromCalendarDate(date) {
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

function evidenceDateKey(parts) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.monthIndex + 1).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function compareEvidenceParts(a, b) {
  const aKey = evidenceDateKey(a);
  const bKey = evidenceDateKey(b);
  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;
  return 0;
}

function isEvidenceHoliday(parts) {
  return EVIDENCE_HOLIDAYS.includes(evidenceDateKey(parts));
}

function isBusinessDay(date) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !isEvidenceHoliday(datePartsFromCalendarDate(date));
}

function getMonthLength(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0)).getUTCDate();
}

function getFirstBusinessDaysOfMonth(year, monthIndex, count) {
  const result = [];
  const totalDays = getMonthLength(year, monthIndex);
  for (let day = 1; day <= totalDays && result.length < count; day += 1) {
    const date = createCalendarDate(year, monthIndex, day);
    if (isBusinessDay(date)) result.push(datePartsFromCalendarDate(date));
  }
  return result;
}

function getLastBusinessDaysOfMonth(year, monthIndex, count) {
  const result = [];
  const totalDays = getMonthLength(year, monthIndex);
  for (let day = totalDays; day >= 1 && result.length < count; day -= 1) {
    const date = createCalendarDate(year, monthIndex, day);
    if (isBusinessDay(date)) result.push(datePartsFromCalendarDate(date));
  }
  return result;
}

function getPreviousMonthPeriod(parts) {
  if (parts.monthIndex === 0) {
    return { year: parts.year - 1, monthIndex: 11 };
  }
  return { year: parts.year, monthIndex: parts.monthIndex - 1 };
}

function buildEvidencePeriod(year, monthIndex) {
  return {
    month: MESES_EVIDENCIA[monthIndex],
    year: String(year),
    monthIndex,
  };
}

function isWithinJune2026Exception(parts) {
  const start = { year: 2026, monthIndex: 6, day: 1 };
  const end = { year: 2026, monthIndex: 6, day: 6 };
  return compareEvidenceParts(parts, start) >= 0 && compareEvidenceParts(parts, end) <= 0;
}

function getEnabledEvidencePeriods(date = new Date()) {
  const nowParts = getMexicoDateParts(date);
  const enabled = new Map();
  const addPeriod = (year, monthIndex) => {
    enabled.set(`${year}-${monthIndex}`, buildEvidencePeriod(year, monthIndex));
  };

  const firstBusinessDays = getFirstBusinessDaysOfMonth(nowParts.year, nowParts.monthIndex, 3);
  if (firstBusinessDays.some((parts) => compareEvidenceParts(parts, nowParts) === 0)) {
    const previousMonth = getPreviousMonthPeriod(nowParts);
    addPeriod(previousMonth.year, previousMonth.monthIndex);
  }

  const lastBusinessDays = getLastBusinessDaysOfMonth(nowParts.year, nowParts.monthIndex, 3);
  if (lastBusinessDays.some((parts) => compareEvidenceParts(parts, nowParts) === 0)) {
    addPeriod(nowParts.year, nowParts.monthIndex);
  }

  // Excepción puntual solicitada: junio 2026 sigue habilitado hasta el 06/07/2026.
  if (isWithinJune2026Exception(nowParts)) {
    addPeriod(2026, 5);
  }

  return Array.from(enabled.values());
}

function getCurrentEvidencePeriod() {
  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    month: "long",
    year: "numeric",
  }).formatToParts(new Date());

  const rawMonth = parts.find((part) => part.type === "month")?.value || "";
  const year = parts.find((part) => part.type === "year")?.value || String(new Date().getFullYear());
  const month = MESES_EVIDENCIA.find((item) => normalizeText(item) === normalizeText(rawMonth)) || rawMonth;

  return { month, year };
}

function isEvidencePeriodEnabled(month, year, date = new Date()) {
  const normalizedMonth = normalizeText(month);
  return getEnabledEvidencePeriods(date).some((item) =>
    normalizeText(item.month) === normalizedMonth && String(item.year) === String(year)
  );
}

function getSafeUploadError(error) {
  const reason = String(
    error?.response?.data?.error ||
    error?.response?.data?.error_description ||
    error?.errors?.[0]?.reason ||
    error?.code ||
    ""
  ).toLowerCase();

  const status = Number(error?.response?.status || error?.code || 0);

  if (reason.includes("invalid_grant") || reason.includes("invalid_client")) {
    return "No se pudo autenticar Google Drive. Revisa el refresh token configurado.";
  }

  if (reason.includes("malformed google drive refresh token")) {
    return "El refresh token de Google Drive está mal configurado. Debe pegarse solo el valor de refresh_token, sin redirect_uri ni client_id.";
  }

  if (reason.includes("google_service_account_json")) {
    return "La llave de cuenta de servicio de Google Drive está mal configurada.";
  }

  if (reason.includes("oauth credentials missing")) {
    return "Faltan credenciales de Google Drive. Configura GOOGLE_SERVICE_ACCOUNT_JSON o las variables OAuth.";
  }

  if (status === 401 || reason.includes("unauthorized")) {
    return "Google Drive rechazó la autenticación. Revisa las credenciales configuradas.";
  }

  if (status === 403 || reason.includes("insufficient") || reason.includes("forbidden")) {
    if (reason.includes("service accounts do not have storage quota")) {
      return "Google Drive rechazó la subida porque la cuenta de servicio no tiene almacenamiento en Mi unidad. Usa un refresh token OAuth válido o mueve la carpeta a una Unidad compartida.";
    }
    return "La cuenta configurada no tiene permiso para subir archivos a la carpeta de Google Drive.";
  }

  if (reason.includes("database") || reason.includes("relation") || reason.includes("column")) {
    return "El PDF se subió, pero no se pudo registrar la evidencia en la base de datos.";
  }

  return "Error al subir evidencia";
}

function logUploadError(error) {
  const status = Number(error?.response?.status || error?.code || 0) || null;
  const googleError = error?.response?.data?.error || null;
  const googleDescription = error?.response?.data?.error_description || null;

  console.error("UPLOAD ERROR:", {
    name: error?.name || "Error",
    message: error?.message || String(error),
    status,
    googleError,
    googleDescription,
  });
}

function isMalformedRefreshToken(value) {
  const token = cleanEnv(value);
  return (
    !token ||
    token.includes("&") ||
    token.includes("redirect_uri") ||
    token.includes("client_id") ||
    token.includes("googleusercontent.com")
  );
}

function parseServiceAccountJson(value) {
  const raw = cleanEnv(value);
  if (!raw) return null;

  try {
    const text = raw.startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const credentials = JSON.parse(text);

    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Service account JSON missing client_email or private_key");
    }

    credentials.private_key = String(credentials.private_key).replace(/\\n/g, "\n");
    return credentials;
  } catch (error) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON inválido");
  }
}

function getGoogleDriveAuth() {
  const mode = cleanEnv(process.env.GOOGLE_DRIVE_AUTH_MODE).toLowerCase();
  const clientId = cleanEnv(process.env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  const refreshToken = cleanEnv(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  const serviceAccountJson = cleanEnv(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  );

  const hasOAuth = clientId && clientSecret && refreshToken;
  const hasValidLookingOAuth = hasOAuth && !isMalformedRefreshToken(refreshToken);

  if (mode !== "service_account" && hasValidLookingOAuth) {
    const auth = new google.auth.OAuth2(clientId, clientSecret, "http://localhost");
    auth.setCredentials({ refresh_token: refreshToken });
    return { auth, mode: "oauth" };
  }

  if (mode === "oauth") {
    if (!hasOAuth) throw new Error("OAuth credentials missing");
    throw new Error("Malformed Google Drive refresh token");
  }

  if (serviceAccountJson) {
    const credentials = parseServiceAccountJson(serviceAccountJson);
    return {
      auth: new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive"],
      }),
      mode: "service_account",
    };
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("OAuth credentials missing");
  }
  if (isMalformedRefreshToken(refreshToken)) {
    throw new Error("Malformed Google Drive refresh token");
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, "http://localhost");
  auth.setCredentials({ refresh_token: refreshToken });

  return { auth, mode: "oauth" };
}

export default async function handler(req, res) {
  // CORS allowlist
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

    const currentPeriod = getCurrentEvidencePeriod();
    const requestedMonth = clean(req.body?.mes, 30);
    const requestedYear = clean(req.body?.anio || currentPeriod.year, 10);

    if (!isEvidencePeriodEnabled(requestedMonth, requestedYear)) {
      return res.status(403).json({
        ok: false,
        error: "Solo se pueden subir evidencias de meses habilitados para carga.",
      });
    }

    const nombre = clean(req.body?.nombre, 200);
    const primerApellido = clean(req.body?.primerApellido, 200);
    const segundoApellido = clean(req.body?.segundoApellido, 200);
    const correo = clean(req.body?.correo, 200);
    const dependencia = clean(session.dependencia, 250);
    const usuarioRegistro = clean(session.usuario || session.id, 200);

    if (!nombre || !primerApellido || !correo) {
      return res.status(400).json({ ok: false, error: "Completa los datos requeridos del Enlace." });
    }

    if (!dependencia) {
      return res.status(403).json({ ok: false, error: "Dependencia no autorizada para registrar evidencias." });
    }

    const folderId = cleanEnv(process.env.DRIVE_FOLDER_ID);
    if (!folderId) {
      return res.status(500).json({ ok: false, error: "DRIVE_FOLDER_ID missing" });
    }

    const { auth } = getGoogleDriveAuth();
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
      supportsAllDrives: true,
      fields: "id, webViewLink",
    });

    const insertRes = await pool.query(
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id
      `,
      [
        requestedMonth,
        requestedYear,
        nombre,
        primerApellido,
        segundoApellido,
        correo,
        uploadRes.data.webViewLink,
        safeName,
        dependencia,
        usuarioRegistro,
        "PENDIENTE",
      ]
    );

    try {
      await logAuditEvent({
        usuario: session.usuario || session.id || "SIN_USUARIO",
        accion: "EVIDENCIA_UPLOAD",
        modulo: "evidencias",
        detalle: {
          evidencia_id: insertRes.rows?.[0]?.id || null,
          cuenta_registro: usuarioRegistro,
          dependencia,
          mes: requestedMonth,
          anio: requestedYear,
          archivo_pdf_nombre: safeName,
          enlace: {
            nombre,
            primer_apellido: primerApellido,
            segundo_apellido: segundoApellido,
            correo,
          },
        },
        ip: req.headers["x-forwarded-for"]?.toString().split(",")[0],
        userAgent: req.headers["user-agent"],
      });
    } catch (_) {
      // El monitoreo no debe romper la subida productiva
    }

    return res.json({
      ok: true,
      evidencia_id: insertRes.rows?.[0]?.id,
      fileId: uploadRes.data.id,
      link: uploadRes.data.webViewLink,
      name: safeName,
      mes: requestedMonth,
      anio: requestedYear,
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

    logUploadError(e);
    return res.status(500).json({ ok: false, error: getSafeUploadError(e) });
  }
}
