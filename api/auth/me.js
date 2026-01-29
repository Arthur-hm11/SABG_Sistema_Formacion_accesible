const { Pool } = require("pg");
const cookie = require("cookie");
const { requireAuth } = require("../_lib/auth");

const conn =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // GET = quién soy
  if (req.method === "GET") {
    const user = await requireAuth(req, res, pool);
    if (!user) return;
    return res.status(200).json({ ok: true, user });
  }

  // POST = logout (sin crear nueva función)
  if (req.method === "POST") {
    try {
      const raw = req.headers?.cookie || "";
      const cookies = cookie.parse(raw || "");
      const token = cookies.session_token;

      if (token) {
        await pool.query("DELETE FROM sesiones WHERE token=$1", [token]);
      }

      res.setHeader(
        "Set-Cookie",
        cookie.serialize("session_token", "", {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        })
      );

      return res.status(200).json({ ok: true, logout: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }

  return res.status(405).json({ ok: false, error: "Método no permitido" });
};
