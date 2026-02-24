import "dotenv/config";
import path from "path";
import express from "express";
import helmet from "helmet";
import { uploadLimiter } from "./api/_lib/limiters.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.disable("x-powered-by");

// Trust proxy (Render/Cloudflare) so req.ip works for rate limiting
app.set("trust proxy", 1);

// Rate limit (only upload)
app.use("/api/evidencias/upload", uploadLimiter);

// Security headers (Helmet)
app.use(helmet({
  contentSecurityPolicy: false, // CSP fino después
  crossOriginEmbedderPolicy: false
}));

// No-store para APIs (evitar cache de respuestas con datos)
app.use((req, res, next) => {
  if ((req.path || "").startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
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
