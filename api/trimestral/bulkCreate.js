const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ======================= Helpers =======================
function normStr(v) {
  if (v === undefined || v === null) return '';
  return String(v)
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function upperStr(v) {
  return normStr(v).toUpperCase();
}

function isSinInfo(v) {
  const s = upperStr(v);
  return (
    s === '' ||
    s === 'SIN INFORMACION' ||
    s === 'SIN INFORMACIÓN' ||
    s === 'S/I' ||
    s === 'NO APLICA' ||
    s === 'N/A' ||
    s === 'NA'
  );
}

function normCurp(v) {
  const s = upperStr(v).replace(/\s+/g, '');
  if (isSinInfo(s)) return '';
  // CURP típico: 18 alfanum
  const ok = /^[A-Z0-9]{18}$/.test(s);
  return ok ? s : ''; // si no cumple, se guarda como ''
}

function trunc(v, max) {
  const s = normStr(v);
  return s.length > max ? s.slice(0, max) : s;
}

function keyForDedup(r) {
  const trimestre = upperStr(r.trimestre || r.TRIMESTRE);
  const pa = upperStr(r.primer_apellido || r['PRIMER APELLIDO']);
  const sa = upperStr(r.segundo_apellido || r['SEGUNDO APELLIDO']);
  const nom = upperStr(r.nombres || r['NOMBRE(S)'] || r['NOMBRES']);
  const curp = normCurp(r.curp || r.CURP);

  // Si hay CURP válido, lo incluimos PERO también nombre para evitar colisiones por CURP mal capturada/repetida
  if (curp) return `C|${trimestre}|${curp}|${pa}|${sa}|${nom}`;
  return `N|${trimestre}|${pa}|${sa}|${nom}`;
}

// ======================= Handler =======================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    const records = Array.isArray(body.records) ? body.records : [];

    if (!records.length) {
      return res.status(400).json({ error: 'No se recibieron registros (body.records vacío).' });
    }

    // 1) Dedupe EN MEMORIA (para evitar que el mismo archivo se suba 2 veces o traiga filas repetidas)
    const seen = new Set();
    const filtered = [];
    let duplicatesInPayload = 0;

    for (const r of records) {
      const k = keyForDedup(r);
      if (seen.has(k)) {
        duplicatesInPayload++;
        continue;
      }
      seen.add(k);
      filtered.push(r);
    }

    // 2) Pre-validación / normalización (y prevenir "value too long")
    // Ajusta máximos si tu tabla tiene otros tamaños.
    const prepared = [];
    const errors = [];
    let curpToEmpty = 0;

    for (let i = 0; i < filtered.length; i++) {
      const r = filtered[i];

      const trimestre = trunc(r.trimestre || r.TRIMESTRE, 50);
      const id_rusp = trunc(r.id_rusp || r['ID RUSP'], 30);

      const primer_apellido = trunc(r.primer_apellido || r['PRIMER APELLIDO'], 120);
      const segundo_apellido = trunc(r.segundo_apellido || r['SEGUNDO APELLIDO'], 120);
      const nombres = trunc(r.nombres || r['NOMBRE(S)'] || r['NOMBRES'], 160);

      const curpNorm = normCurp(r.curp || r.CURP);
      if (!curpNorm) curpToEmpty++;

      // Campos opcionales (no truenan si vienen vacíos)
      const nivel_puesto = trunc(r.nivel_puesto || r['NIVEL DE PUESTO'], 120);
      const nivel_tabular = trunc(r.nivel_tabular || r['NIVEL TABULAR'], 50);
      const ramo_ur = trunc(r.ramo_ur || r['RAMO - UR'], 80);
      const dependencia = trunc(r.dependencia || r['DEPENDENCIA'], 220);
      const observaciones = trunc(r.observaciones || r['OBSERVACIONES'], 400);

      // Validación mínima (esta es la que pediste):
      // Si no trae CURP (o es inválida), se identifica por nombres y apellidos.
      if (!trimestre) {
        errors.push({ index: i, error: 'Falta TRIMESTRE', row: { trimestre } });
        continue;
      }
      if (!primer_apellido || !nombres) {
        // (segundo apellido puede ser vacío en algunos casos)
        errors.push({
          index: i,
          error: 'Faltan PRIMER APELLIDO y/o NOMBRE(S) (necesarios para identificar cuando no hay CURP).',
          row: { trimestre, primer_apellido, segundo_apellido, nombres, curp: curpNorm }
        });
        continue;
      }

      prepared.push({
        trimestre,
        id_rusp,
        primer_apellido,
        segundo_apellido,
        nombres,
        curp: curpNorm, // OJO: '' si no hay CURP válida
        nivel_puesto,
        nivel_tabular,
        ramo_ur,
        dependencia,
        observaciones
      });
    }

    // 3) Insert por chunks con ON CONFLICT
    // Requisito: tener un UNIQUE en la tabla que coincida con esta llave:
    // (trimestre, curp, primer_apellido, segundo_apellido, nombres)
    //
    // IMPORTANTE: curp aquí es '' cuando falta, NO NULL, para que el UNIQUE sí aplique.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let inserted = 0;
      let duplicatesDb = 0;

      const chunkSize = 250; // seguro para serverless
      for (let start = 0; start < prepared.length; start += chunkSize) {
        const chunk = prepared.slice(start, start + chunkSize);

        // Construir query multi-values
        const cols = [
          'trimestre',
          'id_rusp',
          'primer_apellido',
          'segundo_apellido',
          'nombres',
          'curp',
          'nivel_puesto',
          'nivel_tabular',
          'ramo_ur',
          'dependencia',
          'observaciones'
        ];

        const values = [];
        const placeholders = [];
        let p = 1;

        for (const row of chunk) {
          const rowPlace = [];
          for (const c of cols) {
            values.push(row[c] ?? '');
            rowPlace.push(`$${p++}`);
          }
          placeholders.push(`(${rowPlace.join(',')})`);
        }

        const sql = `
          INSERT INTO registros_trimestral
          (${cols.join(', ')})
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (trimestre, curp, primer_apellido, segundo_apellido, nombres)
          DO NOTHING
          RETURNING 1;
        `;

        const r = await client.query(sql, values);
        inserted += r.rowCount;
        duplicatesDb += (chunk.length - r.rowCount);
      }

      await client.query('COMMIT');

      return res.status(200).json({
        ok: true,
        recibidos_frontend: records.length,
        procesados: prepared.length,
        insertados: inserted,
        duplicados_omitidos_payload: duplicatesInPayload,
        duplicados_omitidos_db: duplicatesDb,
        curp_invalida_o_vacia_guardada_como_vacio: curpToEmpty,
        errores: errors, // aquí te salen los que faltan por TRIMESTRE o por nombre/primer apellido
        nota: "Si sigues viendo 'faltantes', casi siempre es por el UNIQUE/ON CONFLICT. Revisa que exista el UNIQUE con (trimestre, curp, primer_apellido, segundo_apellido, nombres) y que curp se guarde como '' (no NULL)."
      });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('bulkCreate error:', e);
      return res.status(500).json({ ok: false, error: e.message });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('bulkCreate fatal:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
