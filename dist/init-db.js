"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const db_1 = require("./db");
async function initDb() {
    await db_1.pool.query(`
    CREATE TABLE IF NOT EXISTS helper_accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      vehicle_type TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS helper_ratings (
      id SERIAL PRIMARY KEY,
      job_id TEXT NOT NULL,
      helper_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      review TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS helpers (
      socket_id TEXT PRIMARY KEY,
      helper_id TEXT,
      name TEXT,
      phone TEXT,
      vehicle_type TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      heading DOUBLE PRECISION DEFAULT 0,
      online BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customers (
      socket_id TEXT PRIMARY KEY,
      name TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      customer_socket_id TEXT NOT NULL,
      helper_socket_id TEXT,
      helper_id TEXT,
      status TEXT NOT NULL,
      service_type TEXT NOT NULL,
      vehicle_type TEXT,
      note TEXT,
      customer_name TEXT,
      customer_latitude DOUBLE PRECISION,
      customer_longitude DOUBLE PRECISION,
      customer_address TEXT,
      helper_name TEXT,
      helper_phone TEXT,
      helper_vehicle_type TEXT,
      quote_cents INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      stripe_payment_intent_id TEXT,
      distance_miles DOUBLE PRECISION NOT NULL DEFAULT 0,
      eta_minutes INTEGER NOT NULL DEFAULT 15,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    console.log("Postgres schema ready.");
    await db_1.pool.end();
}
initDb().catch(async (error) => {
    console.error("DB init failed:", error);
    await db_1.pool.end();
    process.exit(1);
});
