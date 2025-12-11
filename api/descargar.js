const mysql = require("mysql2/promise");

module.exports = async function handler(req, res) {
  let conn;

  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });

    // 1 de enero del año actual
    const ahora = new Date();
    const inicioAno = new Date(ahora.getFullYear(), 0, 1);

    const [rows] = await conn.execute(
      "SELECT id, fecha, datos FROM registros WHERE fecha >= ? ORDER BY fecha ASC",
      [inicioAno]
    );

    // Convertimos a CSV que Excel abre sin problema
    let csv = "id,fecha,datos\n";

    rows.forEach(r => {
      const fecha = r.fecha instanceof Date ? r.fecha.toISOString().replace('T', ' ').slice(0, 19) : r.fecha;
      const datosStr = JSON.stringify(r.datos).replace(/"/g, '""'); // escapamos comillas
      csv += `${r.id},"${fecha}","${datosStr}"\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Registros_SABG_${ahora.getFullYear()}.csv"`
    );

    res.statusCode = 200;
    return res.send(csv);

  } catch (err) {
    console.error("Error en /api/descargar:", err);
    res.statusCode = 500;
    return res.send("Error al generar el archivo");

  } finally {
    if (conn) {
      await conn.end();
    }
  }
};
