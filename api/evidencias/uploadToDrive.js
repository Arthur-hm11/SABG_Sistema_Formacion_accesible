const { requireAuth } = require("../_lib/auth");
const pool = require("../_lib/db.cjs");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Método no permitido" });
  }

  try {
    // 🔐 Validar sesión (en este proyecto requireAuth usa DB, por eso necesita pool)
    const user = await requireAuth(req, res, pool);
    if (!user) return;

    // 📥 Validar payload
    const { filename, mimeType, base64 } = req.body || {};
    if (!filename || !base64) {
      return res.status(400).json({
        success: false,
        error: "Faltan datos requeridos (filename/base64)",
      });
    }

    // 🔑 Variables de entorno
    const SCRIPT_URL = process.env.APPS_SCRIPT_UPLOAD_URL;
    const SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN;

    if (!SCRIPT_URL || !SCRIPT_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "Faltan env vars APPS_SCRIPT_UPLOAD_URL / APPS_SCRIPT_TOKEN",
      });
    }

    // 📤 Enviar a Apps Script
    // Nota importante:
    // - Los Web Apps de Apps Script suelen responder 302 hacia script.googleusercontent.com.
    // - Algunos clientes (incl. fetch) pueden convertir POST→GET al seguir 302/303, rompiendo el upload.
    // Por eso hacemos manejo manual del redirect y repetimos el POST a la URL de Location.
    const payload = JSON.stringify({
      token: SCRIPT_TOKEN,
      filename,
      mimeType: mimeType || "application/pdf",
      base64,
    });

    const doPostJSON = async (url) => {
      const r = await fetch(url, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      // 301/302/303 → reenviar POST a Location
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const loc = r.headers.get("location");
        if (!loc) return { ok: false, status: r.status, text: "Missing redirect Location" };
        const r2 = await fetch(loc, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        return { ok: true, status: r2.status, text: await r2.text() };
      }
      return { ok: true, status: r.status, text: await r.text() };
    };

    const rr = await doPostJSON(SCRIPT_URL);
    const text = rr.text;

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        success: false,
        error: "Respuesta inválida de Apps Script (no JSON)",
        raw: text.slice(0, 300),
      });
    }

    if (!data.success) {
      return res.status(502).json({
        success: false,
        error: data.error || "Fallo al almacenar archivo",
      });
    }

    // ✅ Respuesta limpia
    return res.status(200).json({
      success: true,
      fileId: data.fileId,
      name: data.name,
      webViewLink: data.webViewLink,
      owner: user.usuario,
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return res.status(500).json({
      success: false,
      error: String(err?.message || err),
    });
  }
};
