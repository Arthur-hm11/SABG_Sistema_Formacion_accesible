import rateLimit from "express-rate-limit";

// Upload: estrictito para evitar spam / llenar Drive
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 10,                  // 10 uploads por IP / 10 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many uploads. Try later." },
});
