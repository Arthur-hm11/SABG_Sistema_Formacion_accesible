const ALLOWED = new Set([
  "https://sabg-sistema-formacion.onrender.com",
  "http://localhost:3000",
]);

const FALLBACK_ORIGIN = "https://sabg-sistema-formacion.onrender.com";

export function applyCors(req, res) {
  const originRaw = String(req.headers.origin || "");
  const origin = originRaw.replace(/\/$/, ""); // normalize trailing slash

  // If Origin is allowed, reflect it (strict allowlist).
  if (ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!origin && req.method === "OPTIONS") {
    // Some proxies strip Origin on OPTIONS; allow known prod origin for preflight only.
    res.setHeader("Access-Control-Allow-Origin", FALLBACK_ORIGIN);
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
