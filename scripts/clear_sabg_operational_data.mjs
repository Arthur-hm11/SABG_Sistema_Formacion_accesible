import { Client } from "pg";

const client = new Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getCounts() {
  const { rows } = await client.query(`
    SELECT 'registros_trimestral' AS tabla, COUNT(*)::int AS total
    FROM public.registros_trimestral
    UNION ALL
    SELECT 'registros_trimestral_estado_historial' AS tabla, COUNT(*)::int AS total
    FROM public.registros_trimestral_estado_historial
    UNION ALL
    SELECT 'evidencias_mensuales' AS tabla, COUNT(*)::int AS total
    FROM public.evidencias_mensuales
    ORDER BY tabla
  `);
  return rows;
}

await client.connect();

try {
  await client.query("BEGIN");

  const before = await getCounts();
  console.log("ANTES", JSON.stringify(before));

  await client.query("TRUNCATE TABLE IF EXISTS public.registros_trimestral_estado_historial RESTART IDENTITY");
  await client.query("TRUNCATE TABLE IF EXISTS public.evidencias_mensuales RESTART IDENTITY");
  await client.query("TRUNCATE TABLE IF EXISTS public.registros_trimestral RESTART IDENTITY");

  const after = await getCounts();
  await client.query("COMMIT");

  console.log("DESPUES", JSON.stringify(after));
  console.log("LIMPIEZA_SABG_OK");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  console.error("LIMPIEZA_SABG_ERROR", error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  await client.end();
}
