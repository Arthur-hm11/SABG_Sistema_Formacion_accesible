const { Pool } = require("pg");
const { requireAuth } = require("../_lib/auth");

const conn =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });

  const user = await requireAuth(req, res, pool);
  if (!user) return;

  return res.status(200).json({ ok: true, user });
};
