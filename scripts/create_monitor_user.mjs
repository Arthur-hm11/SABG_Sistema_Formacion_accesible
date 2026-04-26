import bcrypt from "bcryptjs";
import { Client } from "pg";

function reqEnv(name, fallback = "") {
  const value = String(process.env[name] ?? fallback).trim();
  if (!value) {
    throw new Error(`Falta variable requerida: ${name}`);
  }
  return value;
}

const usuario = reqEnv("MONITOR_USERNAME", "MONITOR_SABG").toUpperCase();
const password = reqEnv("MONITOR_PASSWORD");
const correo = reqEnv("MONITOR_EMAIL", "monitor.sabg.20260426@interno.local").toLowerCase();
const curp = reqEnv("MONITOR_CURP", "MOSA900101HDFNNN01").toUpperCase();
const dependencia = reqEnv("MONITOR_DEPENDENCIA", "MONITOREO SABG");
const nombre = reqEnv("MONITOR_NOMBRE", "CUENTA");
const primerApellido = reqEnv("MONITOR_PRIMER_APELLIDO", "MONITOR");
const segundoApellido = reqEnv("MONITOR_SEGUNDO_APELLIDO", "SABG");

const client = new Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await client.query(
    "SELECT id FROM usuarios WHERE UPPER(usuario) = UPPER($1) LIMIT 1",
    [usuario]
  );

  if (existing.rows.length) {
    await client.query(
      `
        UPDATE usuarios
        SET password_hash = $1,
            nombre = $2,
            primer_apellido = $3,
            segundo_apellido = $4,
            correo = $5,
            curp = $6,
            dependencia = $7,
            rol = 'monitor'
        WHERE id = $8
      `,
      [
        passwordHash,
        nombre,
        primerApellido,
        segundoApellido,
        correo,
        curp,
        dependencia,
        existing.rows[0].id,
      ]
    );

    console.log(JSON.stringify({
      success: true,
      action: "updated",
      usuario,
      rol: "monitor",
      dependencia,
    }));
  } else {
    await client.query(
      `
        INSERT INTO usuarios (
          usuario, password_hash, nombre, primer_apellido, segundo_apellido,
          correo, curp, dependencia, rol
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'monitor')
      `,
      [
        usuario,
        passwordHash,
        nombre,
        primerApellido,
        segundoApellido,
        correo,
        curp,
        dependencia,
      ]
    );

    console.log(JSON.stringify({
      success: true,
      action: "created",
      usuario,
      rol: "monitor",
      dependencia,
    }));
  }
} finally {
  await client.end();
}
