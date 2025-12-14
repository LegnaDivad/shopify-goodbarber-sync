const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase/Render suele requerir SSL
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

async function testDb() {
  const client = await pool.connect();
  try {
    const r = await client.query('select now() as now');
    return r.rows[0];
  } finally {
    client.release();
  }
}

module.exports = { pool, testDb };
