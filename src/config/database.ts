// import { Pool } from 'pg';

// let pool: Pool;

// export const initializeDatabase = async () => {
//   pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//   });

//   try {
//     const result = await pool.query('SELECT NOW()');
//     console.log('✓ Database Connected Successfully');
//     return pool;
//   } catch (error) {
//     console.error('Database Connection Error:', error);
//     throw error;
//   }
// };



// Original Working>>>>>>>>>>>>>>>>>>>>>>>>>>

// export const getPool = () => {
//   if (!pool) {
//     throw new Error('Database not initialized');
//   }
//   return pool;
// };

// export const query = async (text: string, params?: any[]) => {
//   const result = await getPool().query(text, params);
//   return result;
// };

// import { Pool } from 'pg';

// let pool: Pool;

// export const initializeDatabase = async () => {
//   pool = new Pool({
//     connectionString: process.env.DATABASE_URL,
//     ssl: { rejectUnauthorized: false },
//     ...( { family: 4 } as any ), // 👈 TypeScript-safe hack for Render IPv4
//   });

//   try {
//     const result = await pool.query('SELECT NOW()');
//     console.log('✅ Database Connected Successfully at:', result.rows[0].now);
//     return pool;
//   } catch (error) {
//     console.error('❌ Database Connection Error:', error);
//     throw error;
//   }
// };

// export const getPool = () => {
//   if (!pool) {
//     throw new Error('Database not initialized');
//   }
//   return pool;
// };

// export const query = async (text: string, params?: any[]) => {
//   const result = await getPool().query(text, params);
//   return result;
// };


import { Pool } from 'pg';
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first'); // Fix for Render IPv4 issue

let pool: Pool | null = null;

export const initializeDatabase = async () => {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ FATAL: DATABASE_URL not set');
    process.exit(1);
  }

  pool = new Pool({
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false, // Fixes Supabase self-signed cert issue
    },
  });

  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database Connected Successfully at:', result.rows[0].now);
    return pool;
  } catch (error) {
    console.error('❌ Database Connection Error:', error);
    throw error;
  }
};

export const getPool = (): Pool => {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
};

export const query = async (text: string, params?: any[]) => {
  if (!pool) throw new Error('Database not initialized');
  const result = await pool.query(text, params);
  return result;
};

// ✅ Proper CommonJS + ES Export for TypeScript & Render builds
export default {
  initializeDatabase,
  getPool,
  query,
};