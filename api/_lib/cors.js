export const ALLOWED_ORIGINS = new Set([
  "https://sabg-sistema-formacion.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const FALLBACK_ORIGIN = "https://sabg-sistema-formacion.onrender.com";

export function normalizeOrigin(value = "") {
  return String(value || "").trim().replace(/\/$/, "");
}

export function isAllowedOrigin(value = "") {
  const origin = normalizeOrigin(value);
  return Boolean(origin && ALLOWED_ORIGINS.has(origin));
}

export function applyCors(req, res) {
  const origin = normalizeOrigin(req.headers.origin || "");

  // If Origin is allowed, reflect it (strict allowlist).
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else if (!origin && req.method === "OPTIONS") {
    // Some proxies strip Origin on OPTIONS; allow known prod origin for preflight only.
    res.setHeader("Access-Control-Allow-Origin", FALLBACK_ORIGIN);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  return null;
}
