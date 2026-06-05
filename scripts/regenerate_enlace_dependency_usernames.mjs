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
  if (!tag) throw new Error("Falta variable requerida: ENLACE_BATCH_TAG");
  if (!/^\d{6}$/.test(tag)) {
    throw new Error("ENLACE_BATCH_TAG debe tener formato YYMMDD");
  }
  return tag;
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
    if (!dep || seen.has(dep)) continue;
    seen.add(dep);
    deps.push(dep);
  }
  return deps;
}

function buildAccounts(dependencies, batchTag, seed) {
  return dependencies.map((dependencia, idx) => {
    const seq = String(idx + 1).padStart(3, "0");
    const usuario = dependencia.toUpperCase();
    const digest = crypto
      .createHmac("sha256", seed)
      .update(`${dependencia}|${usuario}|${batchTag}|${seq}`)
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();
    const password = `SABG-${digest}-${seq}`;
    return {
      dependencia,
      usuario,
      password,
      rol: "enlace",
    };
  });
}

function toCsv(accounts) {
  const headers = ["DEPENDENCIA", "USUARIO", "CONTRASEÑA", "ROL"];
  const lines = [headers.join(",")];
  for (const acc of accounts) {
    lines.push(
      [acc.dependencia, acc.usuario, acc.password, acc.rol]
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

function batchWhereSql(curpParam = "$1") {
  return `
    rol = 'enlace'
    AND nombre = 'ENLACE'
    AND primer_apellido = 'DEPENDENCIA'
    AND segundo_apellido = 'SABG'
    AND curp LIKE ${curpParam}
  `;
}

async function applyAccounts(accounts, batchTag) {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const batchCurpLike = `SABG${batchTag}%`;
    const usernames = accounts.map((a) => a.usuario);

    const existingBatch = await client.query(
      `
        SELECT id, dependencia, usuario, rol
        FROM public.usuarios
        WHERE ${batchWhereSql("$1")}
        ORDER BY dependencia
      `,
      [batchCurpLike]
    );

    if (existingBatch.rows.length !== accounts.length) {
      throw new Error(
        `Lote esperado ${accounts.length}, encontrado ${existingBatch.rows.length}`
      );
    }

    const collisions = await client.query(
      `
        SELECT id, usuario, dependencia, rol
        FROM public.usuarios
        WHERE UPPER(usuario) = ANY($1::text[])
          AND NOT (${batchWhereSql("$2")})
      `,
      [usernames, batchCurpLike]
    );
    if (collisions.rows.length) {
      throw new Error(`Ya existen colisiones para este lote: ${JSON.stringify(collisions.rows)}`);
    }

    await client.query("BEGIN");
    for (const acc of accounts) {
      const passwordHash = await bcrypt.hash(acc.password, 10);
      const update = await client.query(
        `
          UPDATE public.usuarios
          SET usuario = $1,
              password_hash = $2
          WHERE dependencia = $3
            AND ${batchWhereSql("$4")}
        `,
        [acc.usuario, passwordHash, acc.dependencia, batchCurpLike]
      );
      if (Number(update.rowCount || 0) !== 1) {
        throw new Error(`No se pudo actualizar exactamente una cuenta para ${acc.dependencia}`);
      }
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

await applyAccounts(accounts, batchTag);
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
