import "dotenv/config";
import path from "path";
import express from "express";
import helmet from "helmet";
import {
  apiLimiter,
  authLimiter,
  sensitiveExportLimiter,
  uploadLimiter,
} from "./api/_lib/limiters.js";
import { isAllowedOrigin, normalizeOrigin } from "./api/_lib/cors.js";
import pool from "./api/_lib/db.js";
import { getSessionRole, readSabgSession } from "./api/_lib/session.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

function toInt(value, fallback, min, max) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

app.disable("x-powered-by");

// Trust proxy (Render/Cloudflare) so req.ip works for rate limiting
app.set("trust proxy", 1);

// Security headers (Helmet)
app.use(helmet({
  contentSecurityPolicy: false, // CSP fino después
  crossOriginEmbedderPolicy: false
}));

app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  next();
});

// No-store para APIs (evitar cache de respuestas con datos)
app.use((req, res, next) => {
  if ((req.path || "").startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

function originFromReferer(referer) {
  try {
    return referer ? new URL(String(referer)).origin : "";
  } catch {
    return "";
  }
}

// Bloquea acciones API desde sitios no autorizados sin afectar llamadas same-origin.
app.use("/api", (req, res, next) => {
  const method = String(req.method || "").toUpperCase();
  const origin = normalizeOrigin(req.headers.origin || "");

  if (method === "OPTIONS") {
    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ success: false, ok: false, error: "Origen no autorizado" });
    }

    if (origin && isAllowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
    return res.status(200).end();
  }

  if (method === "GET" || method === "HEAD") return next();

  const refererOrigin = normalizeOrigin(originFromReferer(req.headers.referer || ""));
  const requestOrigin = origin || refererOrigin;

  if (requestOrigin && !isAllowedOrigin(requestOrigin)) {
    return res.status(403).json({ success: false, ok: false, error: "Origen no autorizado" });
  }

  return next();
});

// Rate limits por superficie: general, login, cargas y exportaciones.
app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/evidencias/upload", uploadLimiter);
app.use("/api/export/excel", sensitiveExportLimiter);
app.use("/api/backup/export", sensitiveExportLimiter);

const MONITOR_ALLOWED_API_PATHS = new Set([
  "/api/auth/login",
  "/api/health",
  "/api/monitor/ping",
  "/api/monitor/summary",
  "/api/audit/log",
]);

app.use("/api", (req, res, next) => {
  const session = readSabgSession(req);
  if (getSessionRole(session) !== "monitor") return next();

  const pathOnly = String(req.originalUrl || req.url || "").split("?")[0];
  if (MONITOR_ALLOWED_API_PATHS.has(pathOnly)) return next();

  return res.status(403).json({
    success: false,
    error: "La cuenta de monitoreo solo puede consultar el panel de rendimiento",
  });
});
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Estáticos
// Servir SOLO archivos públicos (no exponer el repo)
app.use("/public", express.static(path.join(__dirname, "public")));

// Home
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Helper para montar handlers estilo Vercel: (req,res)=>{}
async function mount(method, route, handlerPath) {
  const mod = await import(handlerPath);
  const handler = mod.default || mod;

  app[method](route, async (req, res) => {
    try {
      return await handler(req, res);
    } catch (e) {
      console.error("API error:", route, e);
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  });

  app.options(route, (req, res) => res.status(200).end());
}

// Montaje de rutas (import dinámico)
await mount("get",  "/api/health",                "./api/health.js");
await mount("get",  "/api/dashboard/seguimiento", "./api/dashboard/seguimiento.js");
await mount("post", "/api/monitor/ping",          "./api/monitor/ping.js");
await mount("get",  "/api/monitor/summary",       "./api/monitor/summary.js");

await mount("post", "/api/evidencias/upload",      "./api/evidencias/upload.js");
await mount("get",  "/api/evidencias/envcheck",   "./api/evidencias/envcheck.js");
await mount("get",  "/api/evidencias/list",       "./api/evidencias/list.js");
await mount("get",  "/api/evidencias/pdf",        "./api/evidencias/pdf.js");
await mount("post", "/api/evidencias/update",     "./api/evidencias/update.js");
await mount("post", "/api/evidencias/delete",     "./api/evidencias/delete.js");
await mount("get",  "/api/trimestral/list",        "./api/trimestral/list.js");
await mount("post", "/api/trimestral/create",      "./api/trimestral/create.js");
await mount("post", "/api/trimestral/bulkCreate",  "./api/trimestral/bulkCreate.js");
await mount("post", "/api/trimestral/batchUpdate", "./api/trimestral/batchUpdate.js");
await mount("post", "/api/trimestral/deleteTest",  "./api/trimestral/deleteTest.js");

await mount("post", "/api/auth/login",             "./api/auth/login.js");
await mount("post", "/api/auth/register",          "./api/auth/register.js");

await mount("post", "/api/upload/excel",           "./api/upload/excel.js");
await mount("get",  "/api/export/excel",           "./api/export/excel.js");
await mount("get",  "/api/backup/export",          "./api/backup/export.js");

await mount("post", "/api/audit/log",              "./api/audit/log.js");

// SPA fallback seguro (NO responder index para rutas tipo archivo)
app.get(/\.*/, (req, res, next) => {
  const p = (req.path || "");

  // No tocar API ni estáticos
  if (p.startsWith("/api/") || p.startsWith("/public/")) return next();

  // Si parece archivo (tiene punto), 404
  if (p.includes(".")) return res.status(404).send("Not found");

  // Solo si el cliente acepta HTML
  const accept = req.headers.accept || "";
  if (!accept.includes("text/html")) return next();

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  return res.sendFile(path.join(__dirname, "index.html"));
});
const server = app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

server.requestTimeout = toInt(process.env.SERVER_REQUEST_TIMEOUT_MS, 60000, 10000, 300000);
server.headersTimeout = toInt(process.env.SERVER_HEADERS_TIMEOUT_MS, 65000, 15000, 300000);
server.keepAliveTimeout = toInt(process.env.SERVER_KEEPALIVE_TIMEOUT_MS, 5000, 1000, 60000);

async function shutdown(signal) {
  console.log(`↘️ ${signal} recibido. Cerrando servidor HTTP...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log("✅ Pool de PostgreSQL cerrado.");
    } catch (error) {
      console.error("Error cerrando pool de PostgreSQL:", error);
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.error("⏱️ Cierre forzado por timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
