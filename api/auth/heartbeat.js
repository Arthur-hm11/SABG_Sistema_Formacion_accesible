import { applyCors } from "../_lib/cors.js";
import { readSabgSession } from "../_lib/session.js";

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-SABG-Session-Touch, X-SABG-No-Touch");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: "No autorizado" });
  }

  return res.status(200).json({
    success: true,
    ok: true,
    timestamp: new Date().toISOString(),
  });
}
