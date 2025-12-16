import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  try {
    const body = JSON.parse(req.body || '{}');

    await sql`
      insert into registros_formacion (payload)
      values (${JSON.stringify(body)})
    `;

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
