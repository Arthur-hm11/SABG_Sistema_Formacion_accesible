import "dotenv/config";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
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
// =========================
// 🔐 API SECURITY GUARD (global)
// Requiere cookie sabg_session firmada (HMAC) para /api/*
// =========================
import crypto from "crypto";

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i === -1) return;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64").toString("utf8");
}

function verifySessionFromReq(req) {
  const secret = process.env.SESSION_SECRET || "";
  if (!secret) return null;

  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.sabg_session;
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0];
  const sig = parts[1];

  const expected = b64urlEncode(
    crypto.createHmac("sha256", secret).update(payloadB64).digest()
  );

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }

  if (payload && payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

const API_PUBLIC = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/evidencias/envcheck"
]);

function requireRole(routePath, user) {
  const rol = (user && user.rol) ? String(user.rol).toLowerCase() : "";

  const adminOnly = [
    "/api/backup/export",
    "/api/export/excel",
    "/api/upload/excel",
    "/api/trimestral/deleteTest",
    "/api/trimestral/bulkCreate"
  ];

  if (adminOnly.includes(routePath)) {
    if (rol !== "admin" && rol !== "superadmin") return false;
  }

  if (routePath === "/api/evidencias/upload") {
    if (!["admin", "superadmin", "enlace"].includes(rol)) return false;
  }

  return true;
}

app.use("/api", (req, res, next) => {
  const full = req.originalUrl.split("?")[0];

  if (API_PUBLIC.has(full)) return next();

  const user = verifySessionFromReq(req);
  if (!user) return res.status(401).json({ success: false, error: "No autenticado" });

  if (!requireRole(full, user)) return res.status(403).json({ success: false, error: "No autorizado" });

  req.user = user;
  return next();
});

await mount("post", "/api/evidencias/upload",      "./api/evidencias/upload.js");
await mount("get",  "/api/evidencias/envcheck",   "./api/evidencias/envcheck.js");
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

  return res.sendFile(path.join(__dirname, "index.html"));
});
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
