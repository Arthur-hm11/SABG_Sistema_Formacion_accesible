const mysql = require("mysql2/promise");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Método no permitido" });
  }

  let conn;

  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });

    // Todo lo que mande el front se guarda tal cual
    const datos = req.body || {};

    await conn.execute(
      "INSERT INTO registros (fecha, datos) VALUES (NOW(), ?)",
      [JSON.stringify(datos)]
    );

    res.statusCode = 200;
    return res.json({ ok: true, mensaje: "Guardado correctamente" });

  } catch (err) {
    console.error("Error en /api/guardar:", err);
    res.statusCode = 500;
    return res.json({ ok: false, error: err.toString() });

  } finally {
    if (conn) {
      await conn.end();
    }
  }
};
