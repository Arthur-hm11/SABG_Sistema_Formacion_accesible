const { requireAuth } = require("../_lib/auth");
const pool = require("../_lib/db.cjs");
const bcrypt = require("bcrypt");

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ success: false, error: "Método no permitido" });

  try {
    // 🔒 Solo superadmin puede registrar usuarios
    const authUser = await requireAuth(req, res, pool);
    if (!authUser) return;
    if (String(authUser.rol || "").toLowerCase() !== "superadmin") {
      return res.status(403).json({ success: false, error: "No autorizado" });
    }

    // Body esperado
    const {
      curp,
      nombre,
      primer_apellido,
      segundo_apellido,
      correo,
      dependencia,
      usuario,
      password,
      rol, // opcional: si no lo mandas, se pone "enlace"
    } = req.body || {};

    // Normalización
    const curpClean = String(curp || "").trim().toUpperCase();
    const nombreClean = String(nombre || "").trim();
    const primerApellidoClean = String(primer_apellido || "").trim();
    const segundoApellidoClean = String(segundo_apellido || "").trim();
    const correoClean = String(correo || "").trim().toLowerCase();
    const dependenciaClean = String(dependencia || "").trim();
    const usuarioClean = String(usuario || "").trim().toUpperCase();
    const passwordClean = String(password || "").trim();

    // Rol permitido (whitelist). Default: enlace
    const rolClean = String(rol || "enlace").trim().toLowerCase();
    const allowedRoles = new Set(["enlace", "admin", "superadmin"]);
    if (!allowedRoles.has(rolClean)) {
      return res
        .status(400)
        .json({ success: false, error: "Rol no permitido", allowed: [...allowedRoles] });
    }

    // Validación + missing list
    const missing = [];
    if (!curpClean) missing.push("curp");
    if (!nombreClean) missing.push("nombre");
    if (!primerApellidoClean) missing.push("primer_apellido");
    if (!segundoApellidoClean) missing.push("segundo_apellido");
    if (!correoClean) missing.push("correo");
    if (!dependenciaClean) missing.push("dependencia");
    if (!usuarioClean) missing.push("usuario");
    if (!passwordClean) missing.push("password");

    if (missing.length) {
      return res
        .status(400)
        .json({ success: false, error: "Todos los campos son requeridos", missing });
    }

    if (curpClean.length !== 18) {
      return res.status(400).json({ success: false, error: "CURP debe tener 18 caracteres" });
    }

    if (usuarioClean.length < 3 || usuarioClean.length > 50) {
      return res.status(400).json({
        success: false,
        error: "El usuario debe tener entre 3 y 50 caracteres",
      });
    }

    if (passwordClean.length < 6) {
      return res.status(400).json({
        success: false,
        error: "La contraseña debe tener al menos 6 caracteres",
      });
    }

    // Dedupe usuario
    const existeUsuario = await pool.query(
      "SELECT 1 FROM usuarios WHERE UPPER(usuario) = $1 LIMIT 1",
      [usuarioClean]
    );
    if (existeUsuario.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: `El usuario "${usuarioClean}" ya está en uso. Sugerencias: ${usuarioClean}1, ${usuarioClean}2, ${usuarioClean}_DF`,
      });
    }

    // Dedupe CURP
    const existeCURP = await pool.query("SELECT 1 FROM usuarios WHERE curp = $1 LIMIT 1", [
      curpClean,
    ]);
    if (existeCURP.rows.length > 0) {
      return res.status(400).json({ success: false, error: "El CURP ya está registrado" });
    }

    // Dedupe correo
    const existeCorreo = await pool.query("SELECT 1 FROM usuarios WHERE correo = $1 LIMIT 1", [
      correoClean,
    ]);
    if (existeCorreo.rows.length > 0) {
      return res.status(400).json({ success: false, error: "El correo ya está registrado" });
    }

    // Hash
    const passwordHash = await bcrypt.hash(passwordClean, 10);

    await pool.query(
      `INSERT INTO usuarios (
        usuario, password_hash, nombre, primer_apellido, segundo_apellido,
        correo, curp, dependencia, rol
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        usuarioClean,
        passwordHash,
        nombreClean,
        primerApellidoClean,
        segundoApellidoClean,
        correoClean,
        curpClean,
        dependenciaClean,
        rolClean,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Usuario registrado exitosamente",
      usuario: usuarioClean,
      rol: rolClean,
    });
  } catch (error) {
    console.error("Error registro:", error);
    return res
      .status(500)
      .json({ success: false, error: "Error en el servidor: " + String(error?.message || error) });
  }
};
