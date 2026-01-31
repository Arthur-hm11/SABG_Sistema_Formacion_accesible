const { Pool } = require("pg");
const { requireAuth, isAdminOrSuper } = require("../_lib/auth");

const conn =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  const user = await requireAuth(req, res, pool);
  if (!user) return;

  try {
    const body = req.body || {};

    // MODO 1: UPDATE OBSERVACIONES (reutiliza /api/trimestral/create)
    // Espera: { id: number, observaciones: string }
    if (body.id !== undefined && body.id !== null) {
      const id = Number(body.id);
      const observaciones = norm(body.observaciones);

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: "id inválido" });
      }

      // enlace: solo puede editar observaciones
      if (String(user.rol || "").toLowerCase() === "enlace") {
        // no permitir que mande otros campos
        const keys = Object.keys(body);
        const extra = keys.filter(k => !["id", "observaciones"].includes(k));
        if (extra.length) {
          return res.status(403).json({ ok: false, error: "Enlace solo puede modificar observaciones" });
        }
      } else {
        // admin/superadmin: ok (permitimos update de observaciones también)
        // si quieres que solo superadmin pueda editar observaciones de cualquiera, aquí se ajusta.
      }

      const r = await pool.query(
        `UPDATE registros_trimestral
         SET observaciones = $1
         WHERE id = $2
         RETURNING id`,
        [observaciones, id]
      );

      if (!r.rows.length) return res.status(404).json({ ok: false, error: "Registro no encontrado" });

      return res.status(200).json({ ok: true, updated: r.rows[0].id });
    }

    // MODO 2: INSERT (solo admin/superadmin)
    if (!isAdminOrSuper(user)) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    // Ajusta aquí a tu esquema real de INSERT (dejo un ejemplo mínimo y seguro)
    const trimestre = norm(body.trimestre);
    const nombre = norm(body.nombre);
    const primer_apellido = norm(body.primer_apellido);
    const segundo_apellido = norm(body.segundo_apellido);
    const curp = norm(body.curp);
    const dependencia = norm(body.dependencia);
    const estado_avance = norm(body.estado_avance);
    const observaciones = norm(body.observaciones);

    if (!trimestre || !curp) {
      return res.status(400).json({ ok: false, error: "Faltan campos requeridos" });
    }

    const ins = await pool.query(
      `INSERT INTO registros_trimestral
        (trimestre, nombre, primer_apellido, segundo_apellido, curp, dependencia, estado_avance, observaciones, usuario_registro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        trimestre,
        nombre,
        primer_apellido,
        segundo_apellido,
        curp,
        dependencia,
        estado_avance,
        observaciones,
        user.usuario,
      ]
    );

    return res.status(201).json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};
