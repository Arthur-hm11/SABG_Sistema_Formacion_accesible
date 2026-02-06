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
app.use(express.static(__dirname, { extensions: ["html"] }));

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

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
