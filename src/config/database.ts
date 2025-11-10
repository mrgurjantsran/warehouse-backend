import { Pool } from 'pg';
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first'); // Fix for Render/Supabase IPv6 issues

let pool: Pool | null = null;

export const initializeDatabase = async () => {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ FATAL: DATABASE_URL not set');
    process.exit(1);
  }

  if (pool) {
    console.log('ℹ️ Database pool already initialized.');
    return pool;
  }

  pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 10, // limit active connections
    idleTimeoutMillis: 30000, // auto-close idle clients after 30s
    connectionTimeoutMillis: 5000, // timeout if cannot connect
  });

  // ✅ Handle unexpected Supabase/Render disconnects
  pool.on('error', (err) => {
    console.error('⚠️ Unexpected database pool error:', err.message);
    console.log('🔁 Attempting to reconnect to database...');
    pool = null;
    setTimeout(() => initializeDatabase().catch(console.error), 5000);
  });

  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database Connected Successfully at:', result.rows[0].now);
    return pool;
  } catch (error) {
    console.error('❌ Database Connection Error:', error);
    console.log('🔁 Retrying connection in 5 seconds...');
    setTimeout(() => initializeDatabase().catch(console.error), 5000);
    throw error;
  }
};

export const getPool = (): Pool => {
  if (!pool) throw new Error('Database not initialized');
  return pool;
};

export const query = async (text: string, params?: any[]) => {
  if (!pool) throw new Error('Database not initialized');
  try {
    return await pool.query(text, params);
  } catch (err: any) {
    console.error('❌ Query execution error:', err.message);
    throw err;
  }
};

export default {
  initializeDatabase,
  getPool,
  query,
};
