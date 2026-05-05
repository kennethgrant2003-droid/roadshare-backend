import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("[db] DATABASE_URL is missing. Postgres queries will fail until it is set.");
}

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

export async function query(text: string, params?: any[]) {
  const start = Date.now();

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (process.env.NODE_ENV !== "production") {
      console.log("[db] query completed", { duration, rows: result.rowCount });
    }

    return result;
  } catch (error) {
    console.error("[db] query failed:", error);
    throw error;
  }
}

export async function closeDb() {
  await pool.end();
}
