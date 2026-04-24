import "dotenv/config";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("[db] DATABASE_URL is missing. Postgres queries will fail until it is set.");
}

export const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

export async function query<T = any>(text: string, params: any[] = []) {
  const result = await pool.query<T>(text, params);
  return result;
}

export async function one<T = any>(text: string, params: any[] = []) {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

export async function many<T = any>(text: string, params: any[] = []) {
  const result = await query<T>(text, params);
  return result.rows;
}
