import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { Client } from "pg";

const NEW_ROWS = [
  { ramo: "12", ur: "547", ramoUr: "12-547", dependencia: 'HOSPITAL GENERAL DE MÉXICO "DR. EDUARDO LICEAGA"' },
  { ramo: "11", ur: "548", ramoUr: "11-548", dependencia: "DIRECCIÓN GENERAL DE BACHILLERATO" },
  { ramo: "18", ur: "549", ramoUr: "18-549", dependencia: "COMISIÓN FEDERAL DE ELECTRICIDAD" },
  { ramo: "18", ur: "550", ramoUr: "18-550", dependencia: "LUZ Y FUERZA DEL CENTRO, EN LIQUIDACIÓN" },
  { ramo: "12", ur: "551", ramoUr: "12-551", dependencia: "DIRECCIÓN GENERAL DE MODERNIZACIÓN DEL SECTOR SALUD" },
  { ramo: "55", ur: "552", ramoUr: "55-552", dependencia: "AGENCIA DE TRANSFORMACIÓN DIGITAL Y TELECOMUNICACIONES" },
  { ramo: "8", ur: "553", ramoUr: "8-553", dependencia: "DIRECCIÓN GENERAL DEL SERVICIO DE INFORMACIÓN AGROALIMENTARIA Y PESQUERA" },
  { ramo: "10", ur: "554", ramoUr: "10-554", dependencia: "COMISIÓN NACIONAL DE MEJORA REGULATORIA" },
  { ramo: "11", ur: "555", ramoUr: "11-555", dependencia: "PEMEX UNIVERSIDAD EMPRESARIAL DE PEMEX, CERTIFICACIONES Y COMPETENCIAS" },
  { ramo: "11", ur: "556", ramoUr: "11-556", dependencia: 'CENTRO DE ESTUDIOS CIENTÍFICOS Y TECNOLÓGICOS N° 5 "BENITO JUÁREZ", INSTITUTO POLITÉCNICO NACIONAL' },
  { ramo: "12", ur: "557", ramoUr: "12-557", dependencia: "CENTRO NACIONAL DE EXCELENCIA TECNOLÓGICA EN SALUD" },
];

const OUTPUT_CSV = process.env.EXPORT_CSV || "/tmp/usuarios_enlace_nuevas_11_dependencias_20260626.csv";
const OUTPUT_XLSX = process.env.EXPORT_XLSX || "/tmp/usuarios_enlace_nuevas_11_dependencias_20260626.xlsx";
const SNAPSHOT_PATH =
  process.env.SNAPSHOT_USERS_PATH || "/tmp/usuarios_snapshot_previos_20260626.json";

function optEnv(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
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

function buildCanonicalUsername(batchTag, sequenceNumber) {
  return `ENL${batchTag}${String(sequenceNumber).padStart(3, "0")}`.toUpperCase();
}

function buildCanonicalCurp(batchTag, index) {
  return `SABG${batchTag}H${toAlphaBlock(index)}${String((index + 1) % 100).padStart(2, "0")}`.toUpperCase();
}

function generateHexPassword() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function buildPasswordForDependenciaMode({ dependencia, usuario, batchTag, sequenceNumber, seed }) {
  if (!seed) {
    return generateHexPassword();
  }
  return crypto
    .createHmac("sha256", seed)
    .update(`${dependencia}|${usuario}|${batchTag}|${String(sequenceNumber).padStart(3, "0")}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}

function buildPasswordForLegacyEnlMode({ dependencia, canonicalUsername, curp, sequenceNumber, seed }) {
  if (!seed) {
    return `SABG-${generateHexPassword()}-${String(sequenceNumber).padStart(3, "0")}`;
  }
  const digest = crypto
    .createHmac("sha256", seed)
    .update(`${dependencia}|${canonicalUsername}|${curp}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `SABG-${digest}-${String(sequenceNumber).padStart(3, "0")}`;
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function getArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has("--dry-run"),
    apply: args.has("--apply"),
  };
}

async function loadCatalog(indexPath) {
  const html = await fs.readFile(indexPath, "utf8");
  const match = html.match(/const\s+DEPENDENCIA_RAMO_UR\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error("No se encontró DEPENDENCIA_RAMO_UR en index.html");
  const context = vm.createContext({ result: null });
  new vm.Script(`result = ${match[1]};`).runInContext(context);
  if (!Array.isArray(context.result)) {
    throw new Error("El catálogo DEPENDENCIA_RAMO_UR no es un arreglo válido");
  }
  return context.result.map((item) => ({
    dependencia: String(item?.dependencia ?? "").trim(),
    ramoUr: String(item?.ramoUr ?? "").trim(),
  }));
}

function validateInputRows() {
  const conflicts = [];
  if (NEW_ROWS.length !== 11) {
    conflicts.push(`Se esperaban 11 registros y se recibieron ${NEW_ROWS.length}`);
  }

  const seenRamoUr = new Set();
  const seenDep = new Set();
  for (const row of NEW_ROWS) {
    if (!row.ramoUr || !row.dependencia) {
      conflicts.push(`Fila incompleta: ${JSON.stringify(row)}`);
    }
    if (seenRamoUr.has(row.ramoUr)) conflicts.push(`RAMO-UR repetido en entrada: ${row.ramoUr}`);
    if (seenDep.has(normalizeText(row.dependencia))) {
      conflicts.push(`Dependencia repetida en entrada: ${row.dependencia}`);
    }
    seenRamoUr.add(row.ramoUr);
    seenDep.add(normalizeText(row.dependencia));
  }
  return conflicts;
}

function validateCatalog(catalog) {
  const conflicts = [];
  const byRamoUr = new Map();
  const byDep = new Map();

  for (const item of catalog) {
    if (!item.dependencia || !item.ramoUr) continue;

    const depKey = normalizeText(item.dependencia);
    const ramoKey = String(item.ramoUr).trim().toUpperCase();

    if (!byRamoUr.has(ramoKey)) byRamoUr.set(ramoKey, new Set());
    byRamoUr.get(ramoKey).add(depKey);

    if (!byDep.has(depKey)) byDep.set(depKey, new Set());
    byDep.get(depKey).add(ramoKey);
  }

  for (const row of NEW_ROWS) {
    const depKey = normalizeText(row.dependencia);
    const ramoKey = row.ramoUr.toUpperCase();

    const depsForRamo = Array.from(byRamoUr.get(ramoKey) || []);
    if (depsForRamo.length !== 1 || depsForRamo[0] !== depKey) {
      conflicts.push(`Conflicto de catálogo RAMO-UR ${row.ramoUr}`);
    }

    const ramosForDep = Array.from(byDep.get(depKey) || []);
    if (ramosForDep.length !== 1 || ramosForDep[0] !== ramoKey) {
      conflicts.push(`Conflicto de catálogo para dependencia ${row.dependencia}`);
    }
  }

  return conflicts;
}

async function getDbContext(client) {
  const anchorRes = await client.query(
    `
      SELECT id, usuario, correo, curp, dependencia, rol
      FROM public.usuarios
      WHERE rol = 'enlace'
        AND nombre = 'ENLACE'
        AND primer_apellido = 'DEPENDENCIA'
        AND segundo_apellido = 'SABG'
        AND curp ~ '^SABG[0-9]{6}H[A-Z]{5}[0-9]{2}$'
      ORDER BY id ASC
    `
  );

  if (!anchorRes.rows.length) {
    throw new Error("No se encontraron cuentas ENLACE base para detectar la lógica actual");
  }

  const batchTags = new Set(anchorRes.rows.map((row) => String(row.curp || "").slice(4, 10)));
  const envBatchTag = optEnv("ENLACE_BATCH_TAG");
  let batchTag = envBatchTag;

  if (batchTag) {
    if (!/^\d{6}$/.test(batchTag)) {
      throw new Error("ENLACE_BATCH_TAG debe tener formato YYMMDD");
    }
  } else if (batchTags.size === 1) {
    batchTag = Array.from(batchTags)[0];
  } else {
    throw new Error(`No se pudo determinar un batchTag único: ${Array.from(batchTags).join(", ")}`);
  }

  const dependencyModeCount = anchorRes.rows.filter(
    (row) => normalizeText(row.usuario) === normalizeText(row.dependencia)
  ).length;
  const legacyEnlModeCount = anchorRes.rows.filter((row) =>
    /^ENL\d{9}$/i.test(String(row.usuario || ""))
  ).length;

  let usernameMode = "mixed";
  if (dependencyModeCount === anchorRes.rows.length) usernameMode = "dependencia";
  if (legacyEnlModeCount === anchorRes.rows.length) usernameMode = "enl";
  if (usernameMode === "mixed") {
    throw new Error(
      `No se detectó un modo único de usernames. dependencia=${dependencyModeCount}, enl=${legacyEnlModeCount}, total=${anchorRes.rows.length}`
    );
  }

  const highestLegacyEnlRes = await client.query(
    `
      SELECT usuario
      FROM public.usuarios
      WHERE usuario ~ '^ENL[0-9]{9}$'
      ORDER BY CAST(SUBSTRING(usuario FROM 4) AS BIGINT) DESC
      LIMIT 1
    `
  );

  return {
    existingAnchorCount: anchorRes.rows.length,
    batchTag,
    usernameMode,
    highestLegacyEnlUsuario: highestLegacyEnlRes.rows[0]?.usuario || null,
    nextSequenceStart: anchorRes.rows.length + 1,
  };
}

function buildPlannedAccounts({ catalog, batchTag, usernameMode, seed, nextSequenceStart }) {
  const planned = [];
  const seenUsers = new Set();
  const seenCurps = new Set();
  const seenEmails = new Set();

  for (let idx = 0; idx < NEW_ROWS.length; idx += 1) {
    const row = NEW_ROWS[idx];
    const catalogIndex = catalog.findIndex(
      (item) =>
        normalizeText(item.dependencia) === normalizeText(row.dependencia) &&
        String(item.ramoUr || "").trim().toUpperCase() === row.ramoUr.toUpperCase()
    );

    if (catalogIndex === -1) {
      throw new Error(`No se encontró ${row.ramoUr} -> ${row.dependencia} en el catálogo actualizado`);
    }

    const sequenceNumber = nextSequenceStart + idx;
    const canonicalUsername = buildCanonicalUsername(batchTag, sequenceNumber);
    const usuario =
      usernameMode === "dependencia" ? row.dependencia.toUpperCase() : canonicalUsername;
    const correo = `${canonicalUsername.toLowerCase()}@usuarios.sabg.mx`;
    const curp = buildCanonicalCurp(batchTag, sequenceNumber - 1);
    const password =
      usernameMode === "dependencia"
        ? buildPasswordForDependenciaMode({
            dependencia: row.dependencia,
            usuario,
            batchTag,
            sequenceNumber,
            seed,
          })
        : buildPasswordForLegacyEnlMode({
            dependencia: row.dependencia,
            canonicalUsername,
            curp,
            sequenceNumber,
            seed,
          });

    if (seenUsers.has(normalizeText(usuario))) throw new Error(`Usuario repetido planeado: ${usuario}`);
    if (seenCurps.has(curp)) throw new Error(`CURP repetida planeada: ${curp}`);
    if (seenEmails.has(correo.toLowerCase())) throw new Error(`Correo repetido planeado: ${correo}`);

    seenUsers.add(normalizeText(usuario));
    seenCurps.add(curp);
    seenEmails.add(correo.toLowerCase());

    planned.push({
      ...row,
      sequenceNumber,
      canonicalUsername,
      usuario,
      correo,
      curp,
      password,
      rol: "enlace",
      nombre: "ENLACE",
      primer_apellido: "DEPENDENCIA",
      segundo_apellido: "SABG",
    });
  }

  return planned;
}

async function validateNoDbConflicts(client, planned) {
  const conflicts = [];

  const usernames = planned.map((row) => row.usuario.toUpperCase());
  const emails = planned.map((row) => row.correo.toLowerCase());
  const curps = planned.map((row) => row.curp);
  const deps = planned.map((row) => row.dependencia);

  const existingRes = await client.query(
    `
      SELECT id, usuario, correo, curp, dependencia, rol
      FROM public.usuarios
      WHERE UPPER(usuario) = ANY($1::text[])
         OR LOWER(correo) = ANY($2::text[])
         OR curp = ANY($3::text[])
         OR dependencia = ANY($4::text[])
      ORDER BY id ASC
    `,
    [usernames, emails, curps, deps]
  );

  for (const row of existingRes.rows) {
    conflicts.push(
      `Conflicto en usuarios: id=${row.id} usuario=${row.usuario} dependencia=${row.dependencia} rol=${row.rol}`
    );
  }

  return conflicts;
}

async function writeSnapshot(client) {
  const snapshotRes = await client.query(
    `
      SELECT id, usuario, nombre, primer_apellido, segundo_apellido, correo, curp, dependencia, rol, created_at
      FROM public.usuarios
      ORDER BY id ASC
    `
  );
  await fs.writeFile(
    SNAPSHOT_PATH,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        total: snapshotRes.rows.length,
        rows: snapshotRes.rows,
      },
      null,
      2
    ),
    "utf8"
  );
}

async function writeCsv(planned) {
  const headers = ["RAMO", "UR", "RAMO_UR", "DEPENDENCIA", "USUARIO", "CONTRASEÑA"];
  const lines = [headers.join(",")];
  for (const row of planned) {
    lines.push(
      [row.ramo, row.ur, row.ramoUr, row.dependencia, row.usuario, row.password]
        .map(escapeCsv)
        .join(",")
    );
  }
  await fs.writeFile(`${OUTPUT_CSV}`, `${lines.join("\n")}\n`, "utf8");
}

async function writeXlsx(planned) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("CUENTAS");
  sheet.columns = [
    { header: "RAMO", key: "ramo", width: 12 },
    { header: "UR", key: "ur", width: 12 },
    { header: "RAMO_UR", key: "ramoUr", width: 16 },
    { header: "DEPENDENCIA", key: "dependencia", width: 60 },
    { header: "USUARIO", key: "usuario", width: 60, style: { numFmt: "@" } },
    { header: "CONTRASEÑA", key: "password", width: 20, style: { numFmt: "@" } },
  ];

  sheet.getRow(1).font = { bold: true };
  for (const row of planned) {
    sheet.addRow({
      ramo: String(row.ramo),
      ur: String(row.ur),
      ramoUr: String(row.ramoUr),
      dependencia: String(row.dependencia),
      usuario: String(row.usuario),
      password: String(row.password),
    });
  }

  sheet.getColumn("usuario").eachCell((cell) => {
    cell.numFmt = "@";
    cell.value = cell.row > 1 ? String(cell.value ?? "") : cell.value;
  });
  sheet.getColumn("password").eachCell((cell) => {
    cell.numFmt = "@";
    cell.value = cell.row > 1 ? String(cell.value ?? "") : cell.value;
  });

  await workbook.xlsx.writeFile(OUTPUT_XLSX);
}

async function verifyXlsx(planned) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(OUTPUT_XLSX);
  const sheet = workbook.getWorksheet("CUENTAS");
  if (!sheet) throw new Error("No se pudo reabrir la hoja CUENTAS del Excel exportado");

  for (let i = 0; i < planned.length; i += 1) {
    const rowNumber = i + 2;
    const row = sheet.getRow(rowNumber);
    const usuario = String(row.getCell(5).value ?? "");
    const password = String(row.getCell(6).value ?? "");
    if (usuario !== planned[i].usuario) {
      throw new Error(`Excel inválido en fila ${rowNumber}: usuario no coincide`);
    }
    if (password !== planned[i].password) {
      throw new Error(`Excel inválido en fila ${rowNumber}: contraseña no coincide`);
    }
  }
}

async function main() {
  const { dryRun, apply } = getArgs();
  if (!dryRun && !apply) {
    throw new Error("Debes indicar --dry-run o --apply");
  }
  if (dryRun && apply) {
    throw new Error("Usa solo un modo: --dry-run o --apply");
  }

  const seed = optEnv("ENLACE_PASSWORD_SEED");
  const indexPath = path.resolve(process.cwd(), "index.html");
  const inputConflicts = validateInputRows();
  if (inputConflicts.length) {
    throw new Error(inputConflicts.join(" | "));
  }

  const catalog = await loadCatalog(indexPath);
  const catalogConflicts = validateCatalog(catalog);
  if (catalogConflicts.length) {
    throw new Error(catalogConflicts.join(" | "));
  }

  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const dbContext = await getDbContext(client);
    const planned = buildPlannedAccounts({
      catalog,
      batchTag: dbContext.batchTag,
      usernameMode: dbContext.usernameMode,
      seed,
      nextSequenceStart: dbContext.nextSequenceStart,
    });

    const dbConflicts = await validateNoDbConflicts(client, planned);
    const autollenadoChecks = [
      { ramoUr: "12-547", dependencia: 'HOSPITAL GENERAL DE MÉXICO "DR. EDUARDO LICEAGA"' },
      { ramoUr: "55-552", dependencia: "AGENCIA DE TRANSFORMACIÓN DIGITAL Y TELECOMUNICACIONES" },
      { ramoUr: "12-557", dependencia: "CENTRO NACIONAL DE EXCELENCIA TECNOLÓGICA EN SALUD" },
    ].map((item) => {
      const found = catalog.find(
        (row) =>
          String(row.ramoUr || "").trim().toUpperCase() === item.ramoUr &&
          normalizeText(row.dependencia) === normalizeText(item.dependencia)
      );
      return { ...item, ok: Boolean(found) };
    });

    const dryRunReport = {
      success: dbConflicts.length === 0,
      mode: "dry_run",
      noDbChanges: true,
      totalReceived: NEW_ROWS.length,
      totalWouldCreate: planned.length,
      detectedBatchTag: dbContext.batchTag,
      detectedUsernameMode: dbContext.usernameMode,
      existingAnchorCount: dbContext.existingAnchorCount,
      highestLegacyEnlUsuario: dbContext.highestLegacyEnlUsuario,
      nextSequenceStart: dbContext.nextSequenceStart,
      passwordStrategy: seed
        ? "hmac_seed_actual"
        : dbContext.usernameMode === "dependencia"
          ? "hex_8_actual_sin_semilla_en_entorno"
          : "legacy_sabg_hex_seq_sin_semilla_en_entorno",
      firstUsuario: planned[0]?.usuario || null,
      lastUsuario: planned[planned.length - 1]?.usuario || null,
      rows: planned.map((row) => ({
        ramo: row.ramo,
        ur: row.ur,
        ramoUr: row.ramoUr,
        dependencia: row.dependencia,
        usuario: row.usuario,
        sequenceNumber: row.sequenceNumber,
      })),
      autollenadoChecks,
      conflicts: dbConflicts,
    };

    if (dryRun) {
      console.log(JSON.stringify(dryRunReport, null, 2));
      return;
    }

    if (dbConflicts.length) {
      throw new Error(`Conflictos detectados: ${dbConflicts.join(" | ")}`);
    }

    await client.query("BEGIN");
    await writeSnapshot(client);

    const insertedRows = [];
    for (const row of planned) {
      const passwordHash = await bcrypt.hash(row.password, 10);
      const insertRes = await client.query(
        `
          INSERT INTO public.usuarios (
            usuario, password_hash, nombre, primer_apellido, segundo_apellido,
            correo, curp, dependencia, rol
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING id, usuario, password_hash, dependencia, rol
        `,
        [
          row.usuario,
          passwordHash,
          row.nombre,
          row.primer_apellido,
          row.segundo_apellido,
          row.correo,
          row.curp,
          row.dependencia,
          row.rol,
        ]
      );
      insertedRows.push(insertRes.rows[0]);
    }

    for (let i = 0; i < insertedRows.length; i += 1) {
      const row = insertedRows[i];
      const ok = await bcrypt.compare(planned[i].password, row.password_hash);
      if (!ok) {
        throw new Error(`bcrypt.compare falló para ${planned[i].usuario}`);
      }
    }

    await fs.mkdir(path.dirname(OUTPUT_CSV), { recursive: true });
    await fs.mkdir(path.dirname(OUTPUT_XLSX), { recursive: true });
    await writeCsv(planned);
    await writeXlsx(planned);
    await verifyXlsx(planned);

    const verifyCountRes = await client.query(
      `
        SELECT COUNT(*)::int AS total
        FROM public.usuarios
        WHERE dependencia = ANY($1::text[])
          AND rol = 'enlace'
      `,
      [planned.map((row) => row.dependencia)]
    );

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          success: true,
          mode: "apply",
          totalCreated: planned.length,
          detectedBatchTag: dbContext.batchTag,
          detectedUsernameMode: dbContext.usernameMode,
          existingAnchorCountBefore: dbContext.existingAnchorCount,
          highestLegacyEnlUsuario: dbContext.highestLegacyEnlUsuario,
          nextSequenceStart: dbContext.nextSequenceStart,
          passwordStrategy: seed
            ? "hmac_seed_actual"
            : dbContext.usernameMode === "dependencia"
              ? "hex_8_actual_sin_semilla_en_entorno"
              : "legacy_sabg_hex_seq_sin_semilla_en_entorno",
          firstUsuario: planned[0]?.usuario || null,
          lastUsuario: planned[planned.length - 1]?.usuario || null,
          snapshotPath: SNAPSHOT_PATH,
          outputCsv: OUTPUT_CSV,
          outputXlsx: OUTPUT_XLSX,
          autollenadoStoredIn: "index.html",
          autollenadoChecks,
          verifyInsertedCount: Number(verifyCountRes.rows[0]?.total || 0),
          credentialRows: planned.map((row) => ({
            ramo: row.ramo,
            ur: row.ur,
            ramoUr: row.ramoUr,
            dependencia: row.dependencia,
            usuario: row.usuario,
            password: row.password,
          })),
        },
        null,
        2
      )
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
