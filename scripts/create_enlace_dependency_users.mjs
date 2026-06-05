import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";

function reqEnv(name, fallback = "") {
  const value = String(process.env[name] ?? fallback).trim();
  if (!value) {
    throw new Error(`Falta variable requerida: ${name}`);
  }
  return value;
}

function optEnv(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function buildBatchTag() {
  const tag = optEnv("ENLACE_BATCH_TAG");
  if (tag) {
    if (!/^\d{6}$/.test(tag)) {
      throw new Error("ENLACE_BATCH_TAG debe tener formato YYMMDD");
    }
    return tag;
  }
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function toAlphaBlock(index) {
  let n = Number(index);
  const chars = [];
  for (let i = 0; i < 5; i += 1) {
    chars.unshift(String.fromCharCode(65 + (n % 26)));
    n = Math.floor(n / 26);
  }
  return chars.join("");
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function loadDependencies() {
  const indexPath = path.resolve(process.cwd(), "index.html");
  const html = await fs.readFile(indexPath, "utf8");
  const match = html.match(/const\s+DEPENDENCIA_RAMO_UR\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error("No se encontró DEPENDENCIA_RAMO_UR en index.html");
  const context = vm.createContext({ result: null });
  new vm.Script(`result = ${match[1]};`).runInContext(context);
  const rows = Array.isArray(context.result) ? context.result : [];
  const deps = [];
  const seen = new Set();
  for (const row of rows) {
    const dep = String(row?.dependencia ?? "").trim();
    if (!dep) continue;
    if (seen.has(dep)) continue;
    seen.add(dep);
    deps.push(dep);
  }
  return deps;
}

function buildAccounts(dependencies, batchTag, seed) {
  return dependencies.map((dependencia, idx) => {
    const seq = String(idx + 1).padStart(3, "0");
    const username = `ENL${batchTag}${seq}`.toUpperCase();
    const alpha = toAlphaBlock(idx);
    const suffix = String((idx + 1) % 100).padStart(2, "0");
    const curp = `SABG${batchTag}H${alpha}${suffix}`.toUpperCase();
    const email = `${username.toLowerCase()}@usuarios.sabg.mx`;
    const digest = crypto
      .createHmac("sha256", seed)
      .update(`${dependencia}|${username}|${curp}`)
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();
    const password = `SABG-${digest}-${seq}`;
    return {
      dependencia,
      usuario: username,
      password,
      correo: email,
      curp,
      nombre: "ENLACE",
      primer_apellido: "DEPENDENCIA",
      segundo_apellido: "SABG",
      rol: "enlace",
    };
  });
}

function toCsv(accounts) {
  const headers = [
    "DEPENDENCIA",
    "USUARIO",
    "CONTRASEÑA",
    "ROL",
    "CORREO",
    "CURP",
    "NOMBRE",
    "PRIMER_APELLIDO",
    "SEGUNDO_APELLIDO",
  ];
  const lines = [headers.join(",")];
  for (const acc of accounts) {
    lines.push(
      [
        acc.dependencia,
        acc.usuario,
        acc.password,
        acc.rol,
        acc.correo,
        acc.curp,
        acc.nombre,
        acc.primer_apellido,
        acc.segundo_apellido,
      ]
        .map(escapeCsv)
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

async function maybeExportCsv(accounts) {
  const outputPath = optEnv("EXPORT_CSV");
  if (!outputPath) return;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, toCsv(accounts), "utf8");
}

async function applyAccounts(accounts) {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const usernames = accounts.map((a) => a.usuario);
    const emails = accounts.map((a) => a.correo);
    const curps = accounts.map((a) => a.curp);

    const existing = await client.query(
      `
        SELECT usuario, correo, curp, dependencia, rol
        FROM public.usuarios
        WHERE UPPER(usuario) = ANY($1::text[])
           OR LOWER(correo) = ANY($2::text[])
           OR curp = ANY($3::text[])
      `,
      [usernames, emails, curps]
    );
    if (existing.rows.length) {
      throw new Error(`Ya existen colisiones para este lote: ${JSON.stringify(existing.rows)}`);
    }

    await client.query("BEGIN");
    for (const acc of accounts) {
      const passwordHash = await bcrypt.hash(acc.password, 10);
      await client.query(
        `
          INSERT INTO public.usuarios (
            usuario, password_hash, nombre, primer_apellido, segundo_apellido,
            correo, curp, dependencia, rol
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          acc.usuario,
          passwordHash,
          acc.nombre,
          acc.primer_apellido,
          acc.segundo_apellido,
          acc.correo,
          acc.curp,
          acc.dependencia,
          acc.rol,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

const batchTag = buildBatchTag();
const seed = reqEnv("ENLACE_PASSWORD_SEED");
const dependencies = await loadDependencies();
const accounts = buildAccounts(dependencies, batchTag, seed);
await maybeExportCsv(accounts);

if (optEnv("DRY_RUN") === "1") {
  console.log(
    JSON.stringify({
      success: true,
      mode: "dry_run",
      batchTag,
      total: accounts.length,
      first: accounts[0],
      last: accounts[accounts.length - 1],
    })
  );
  process.exit(0);
}

await applyAccounts(accounts);
console.log(
  JSON.stringify({
    success: true,
    mode: "apply",
    batchTag,
    total: accounts.length,
    firstUsuario: accounts[0]?.usuario || null,
    lastUsuario: accounts[accounts.length - 1]?.usuario || null,
  })
);
