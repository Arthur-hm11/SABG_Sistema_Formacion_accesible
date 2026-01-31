const APPS_SCRIPT_UPLOAD_URL = process.env.APPS_SCRIPT_UPLOAD_URL;
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(new Error("JSON inválido"));
      }
    });
  });
}

async function fetchJson(url, options = {}) {
  const r = await fetch(url, options);
  const txt = await r.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch (_) {}
  return { r, txt, json };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    if (!APPS_SCRIPT_UPLOAD_URL || !APPS_SCRIPT_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "Faltan env vars APPS_SCRIPT_UPLOAD_URL / APPS_SCRIPT_TOKEN",
      });
    }

    const body = await readJson(req);
    const { filename, mimeType, base64 } = body;

    if (!filename || !mimeType || !base64) {
      return res
        .status(400)
        .json({ success: false, error: "Faltan campos: filename, mimeType, base64" });
    }

    // 1) POST al Apps Script SIN seguir redirects
    const postPayload = JSON.stringify({
      token: APPS_SCRIPT_TOKEN,
      filename,
      mimeType,
      base64,
    });

    const post = await fetch(APPS_SCRIPT_UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: postPayload,
      redirect: "manual", // <- CLAVE: no seguir 302
    });

    const loc = post.headers.get("location");
    if (!loc) {
      const txt = await post.text().catch(() => "");
      return res.status(502).json({
        success: false,
        error: "No llegó header Location desde Apps Script",
        status: post.status,
        body: txt.slice(0, 600),
      });
    }

    // 2) GET al Location: aquí viene el JSON final con fileId/webViewLink
    const get = await fetchJson(loc, { method: "GET" });

    if (!get.json) {
      return res.status(502).json({
        success: false,
        error: "Respuesta no-JSON al hacer GET al Location",
        status: get.r.status,
        body: get.txt.slice(0, 600),
      });
    }

    return res.status(200).json(get.json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || "Error interno" });
  }
};
