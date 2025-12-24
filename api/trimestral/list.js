const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { dependencia } = req.query;

    let query = 'SELECT * FROM registros_formacion ORDER BY created_at DESC';
    let params = [];

    if (dependencia && dependencia !== 'null') {
      query = 'SELECT * FROM registros_formacion WHERE dependencia ILIKE $1 ORDER BY created_at DESC';
      params = [`%${dependencia}%`];
    }

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Error al listar registros:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Error en el servidor'
    });
  }
};
```

3. Guarda como: **`list.js`** (en `api/trimestral/`)

---

## **PASO 4: Verificar que todos los archivos estén en su lugar**

Tu carpeta **`sabg-sistema`** debe verse así:
```
📁 sabg-sistema
  📄 index.html
  📄 package.json
  📄 vercel.json
  📁 api
    📁 auth
      📄 login.js
      📄 register.js
    📁 trimestral
      📄 create.js
      📄 list.js
    📁 evidencias
      (vacía por ahora)