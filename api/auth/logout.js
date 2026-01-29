const { Pool } = require("pg");
const cookie = require("cookie");

const conn =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

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

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};
