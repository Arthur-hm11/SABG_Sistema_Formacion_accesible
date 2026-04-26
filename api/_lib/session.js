import crypto from "crypto";

function parseCookies(cookieHeader = "") {
  const out = {};
  String(cookieHeader || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

export function readSabgSession(req) {
  try {
    const cookies = parseCookies(req?.headers?.cookie || "");
    const raw = cookies.sabg_session;
    if (!raw || !raw.includes(".")) return null;

    const [payloadB64, sig] = raw.split(".");
    const secret = process.env.SESSION_SECRET || "";
    if (!secret) return null;

    const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const sigBuf = Buffer.from(String(sig || ""), "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }

    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");

    const payload = JSON.parse(json);
    if (!payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function isAdminSession(session) {
  const rol = getSessionRole(session);
  return rol === "admin" || rol === "superadmin";
}

export function isSuperAdminSession(session) {
  return getSessionRole(session) === "superadmin";
}

export function isMonitorSession(session) {
  return getSessionRole(session) === "monitor";
}

export function getSessionRole(session) {
  const rol = String(session?.rol || "").toLowerCase().trim();
  return rol === "administrador" ? "admin" : rol;
}
