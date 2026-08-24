const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não configurada.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false }
});

app.use(express.json({ limit: '20mb' }));

async function initDb() {
  // Mantém os dados atuais. Não apaga tabelas nem registros.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Garante o registro principal sem sobrescrever dados existentes.
  await pool.query(`
    INSERT INTO app_state (id, data)
    VALUES ('vale-da-serra', '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
}

app.get('/api/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, db: true, now: r.rows[0].now });
  } catch (e) {
    console.error('Health check:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/state', async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT data, updated_at FROM app_state WHERE id = 'vale-da-serra'"
    );
    if (!r.rowCount) {
      return res.json({ ok: true, exists: false, data: null });
    }
    res.json({
      ok: true,
      exists: true,
      data: r.rows[0].data,
      updatedAt: r.rows[0].updated_at
    });
  } catch (e) {
    console.error('GET /api/state:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const data = req.body && req.body.data;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'Dados inválidos' });
    }

    await pool.query(`
      INSERT INTO app_state (id, data, updated_at)
      VALUES ('vale-da-serra', $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [JSON.stringify(data)]);

    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/state:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use(express.static(__dirname));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Vale da Serra online na porta ${PORT}`);
      console.log('PostgreSQL conectado e dados preservados.');
    });
  })
  .catch(err => {
    console.error('Falha ao iniciar banco:', err);
    process.exit(1);
  });
