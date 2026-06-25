import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const outputDir = path.join(rootDir, "outputs");
const outputFile = path.join(outputDir, `usuarios_snapshot_${timestamp}.json`);

const client = new Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await client.connect();

  const result = await client.query(`
    SELECT
      id,
      usuario,
      password_hash,
      nombre,
      primer_apellido,
      segundo_apellido,
      correo,
      curp,
      dependencia,
      rol,
      active_session_id,
      active_session_expires_at,
      locked_until,
      created_at
    FROM public.usuarios
    ORDER BY id ASC
  `);

  await fs.writeFile(
    outputFile,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        total: result.rows.length,
        rows: result.rows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`SNAPSHOT_OK ${outputFile}`);
}

main()
  .catch((error) => {
    console.error("SNAPSHOT_ERROR", error?.stack || error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.end();
    } catch {
      // noop
    }
  });
