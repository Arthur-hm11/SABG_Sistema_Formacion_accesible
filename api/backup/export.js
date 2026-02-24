import pool from "../_lib/db.js";
import { applyCors } from "../_lib/cors.js";

export default async function handler(req, res) {
  // SECURITY: require session cookie
  const cookie = String(req.headers.cookie || "");
  if (!cookie.includes("sabg_session=")) return res.status(401).json({ success:false, error:"Unauthorized" });
  const pre = applyCors(req, res);
  if (pre) return;
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Método no permitido" });

  try {
    const registros = await pool.query("SELECT * FROM registros_trimestral ORDER BY created_at DESC");
    const usuarios = await pool.query(
      `SELECT id, usuario, password_hash, nombre, primer_apellido, segundo_apellido,
              correo, curp, dependencia, rol, created_at
       FROM usuarios
       ORDER BY created_at DESC`
    );

    const today = new Date();
    const isoDate = today.toISOString().split("T")[0];

    const backup = {
      fecha_backup: today.toISOString(),
      total_registros: registros.rows.length,
      total_usuarios: usuarios.rows.length,
      registros: registros.rows,
      usuarios: usuarios.rows,
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=backup_sabg_${isoDate}.json`);
    return res.status(200).json(backup);
  } catch (error) {
    console.error("Error al generar backup:", error);
    return res.status(500).json({ success: false, error: "Error al generar backup: " + (error?.message || String(error)) });
  }
}
