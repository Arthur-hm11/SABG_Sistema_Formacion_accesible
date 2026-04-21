import rateLimit from "express-rate-limit";

const rateLimitJson = (message) => ({
  success: false,
  ok: false,
  error: message,
});

const skipOptions = (req) => req.method === "OPTIONS";

// General API protection: generous enough for normal use, blocks bursts/scans.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipOptions,
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
