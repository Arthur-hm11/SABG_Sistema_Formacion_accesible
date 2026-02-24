import bcrypt from "bcryptjs";
import pool from "../_lib/db.js";

function norm(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://sabg-sistema-formacion.onrender.com");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  try {
    const {
      curp,
      nombre,
      primer_apellido,
      segundo_apellido,
      correo,
      dependencia,
      usuario,
      password,
    } = req.body || {};

    const curpClean = norm(curp).toUpperCase();
    const nombreClean = norm(nombre);
    const primerApellidoClean = norm(primer_apellido);
    const segundoApellidoClean = norm(segundo_apellido);
    const correoClean = norm(correo).toLowerCase();
    const dependenciaClean = norm(dependencia);
    const usuarioClean = norm(usuario).toUpperCase();
    const passwordClean = norm(password);

    if (
      !curpClean ||
      !nombreClean ||
      !primerApellidoClean ||
      !segundoApellidoClean ||
      !correoClean ||
      !dependenciaClean ||
      !usuarioClean ||
      !passwordClean
    ) {
      return res.status(400).json({ success: false, error: "Todos los campos son requeridos" });
    }

    if (curpClean.length !== 18) {
      return res.status(400).json({ success: false, error: "CURP debe tener 18 caracteres" });
    }
    if (usuarioClean.length < 3) {
      return res.status(400).json({ success: false, error: "El usuario debe tener al menos 3 caracteres" });
    }
    if (passwordClean.length < 6) {
      return res.status(400).json({ success: false, error: "La contraseña debe tener al menos 6 caracteres" });
    }

    // Verificar si el USUARIO ya existe
    const existeUsuario = await pool.query(
      "SELECT 1 FROM usuarios WHERE UPPER(usuario) = $1",
      [usuarioClean]
    );
    if (existeUsuario.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: `El usuario "${usuarioClean}" ya está en uso. Sugerencias: ${usuarioClean}1, ${usuarioClean}2, ${usuarioClean}_DF`,
      });
    }

    // Verificar si el CURP ya existe
    const existeCURP = await pool.query("SELECT 1 FROM usuarios WHERE curp = $1", [curpClean]);
    if (existeCURP.rows.length > 0) {
      return res.status(400).json({ success: false, error: "El CURP ya está registrado" });
    }

    // Verificar si el correo ya existe
    const existeCorreo = await pool.query("SELECT 1 FROM usuarios WHERE correo = $1", [correoClean]);
    if (existeCorreo.rows.length > 0) {
      return res.status(400).json({ success: false, error: "El correo ya está registrado" });
    }

    // Hash bcrypt
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
        "enlace",
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Usuario registrado exitosamente",
      usuario: usuarioClean,
    });
  } catch (error) {
    console.error("Error registro:", error);
    return res.status(500).json({ success: false, error: "Error en el servidor: " + (error?.message || String(error)) });
  }
}
