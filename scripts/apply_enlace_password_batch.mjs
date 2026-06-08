import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import bcrypt from "bcryptjs";
import { Client } from "pg";

function batchWhereSql(curpParam = "$1") {
  return `
    rol = 'enlace'
    AND nombre = 'ENLACE'
    AND primer_apellido = 'DEPENDENCIA'
    AND segundo_apellido = 'SABG'
    AND curp LIKE ${curpParam}
  `;
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

async function main() {
  const batchTag = process.env.ENLACE_BATCH_TAG || "260605";
  const passwordFile = process.env.ENLACE_PASSWORD_B64_FILE || "/tmp/passwords260605.b64";
  const batchCurpLike = `SABG${batchTag}%`;

  const passwords = JSON.parse(
    Buffer.from(await fs.readFile(passwordFile, "utf8"), "base64").toString("utf8")
  );
  const dependencies = await loadDependencies();

  if (passwords.length !== dependencies.length) {
    throw new Error(`Passwords ${passwords.length} != dependencias ${dependencies.length}`);
  }

  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const existing = await client.query(
      `SELECT COUNT(*)::int AS total FROM public.usuarios WHERE ${batchWhereSql("$1")}`,
      [batchCurpLike]
    );

    await client.query("BEGIN");

    for (let i = 0; i < dependencies.length; i++) {
      const dep = dependencies[i];
      const usuario = dep.toUpperCase();
      const passwordHash = await bcrypt.hash(passwords[i], 10);

      const upd = await client.query(
        `UPDATE public.usuarios
           SET usuario = $1,
               password_hash = $2
         WHERE dependencia = $3
           AND ${batchWhereSql("$4")}`,
        [usuario, passwordHash, dep, batchCurpLike]
      );

      if (Number(upd.rowCount || 0) !== 1) {
        throw new Error(`No se pudo actualizar exactamente una cuenta para ${dep}`);
      }
    }

    const verify = await client.query(
      `SELECT id, usuario, password_hash
         FROM public.usuarios
        WHERE ${batchWhereSql("$1")}
        ORDER BY id
        LIMIT 3`,
      [batchCurpLike]
    );

    const checks = [];
    for (let i = 0; i < verify.rows.length; i++) {
      checks.push({
        id: verify.rows[i].id,
        usuario: verify.rows[i].usuario,
        ok: await bcrypt.compare(passwords[i], verify.rows[i].password_hash),
      });
    }

    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        success: true,
        batchTag,
        total: dependencies.length,
        batchRows: existing.rows[0].total,
        checks,
      })
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
