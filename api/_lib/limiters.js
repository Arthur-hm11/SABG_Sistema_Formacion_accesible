import rateLimit from "express-rate-limit";

const rateLimitJson = (message) => ({
  success: false,
  ok: false,
  error: message,
});

const skipOptions = (req) => req.method === "OPTIONS";

function getRequestPath(req) {
  return String(req?.originalUrl || req?.url || req?.path || "").split("?")[0];
}

function skipGeneralApiLimit(req) {
  if (skipOptions(req)) return true;
  const path = getRequestPath(req);
  return (
    path === "/api/auth/login" ||
    path === "/auth/login" ||
    path === "/api/health" ||
    path === "/health"
  );
}

// General API protection:
// - Keep brute-force protection on /api/auth/login in the dedicated auth limiter.
// - Be more tolerant for real multi-user traffic behind a shared government/public IP.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipGeneralApiLimit,
  message: rateLimitJson("Demasiadas solicitudes. Intenta nuevamente más tarde."),
});

// Login: reduce brute-force attempts without affecting successful users.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipOptions,
  skipSuccessfulRequests: true,
  message: rateLimitJson("Demasiados intentos de inicio de sesión. Intenta más tarde."),
});

// Upload: estrictito para evitar spam / llenar Drive
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 10,                  // 10 uploads por IP / 10 min
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipOptions,
  message: rateLimitJson("Demasiadas cargas. Intenta más tarde."),
});

// Endpoints that can expose large/sensitive exports.
export const sensitiveExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipOptions,
  message: rateLimitJson("Demasiadas descargas. Intenta más tarde."),
});
