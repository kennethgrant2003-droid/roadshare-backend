import { query } from "./db";

async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS earnings (
      id SERIAL PRIMARY KEY,
      job_id TEXT,
      helper_id INTEGER,
      amount_cents INTEGER,
      platform_fee_cents INTEGER,
      payout_cents INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("? Earnings table ready");
}

init().catch(console.error);
