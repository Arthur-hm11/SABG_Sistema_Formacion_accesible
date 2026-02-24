const ALLOWED = new Set([
  "https://sabg-sistema-formacion.onrender.com",
  "http://localhost:3000",
]);

export function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // Si usas cookies cross-site, necesitarías Allow-Credentials y SameSite=None en la cookie.
    // Por ahora NO lo activamos para no abrir más de lo necesario.
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept"
  );

  if (req.method === "OPTIONS") {
    // Si origin no está permitido, responde igualmente pero sin Allow-Origin
    return res.status(200).end();
  }
  return null;
}
