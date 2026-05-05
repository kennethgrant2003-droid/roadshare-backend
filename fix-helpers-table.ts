import "dotenv/config";
import { query } from "./src/db";

async function run() {
  try {
    await query(`
      ALTER TABLE helpers
      ADD COLUMN IF NOT EXISTS id BIGSERIAL
    `);

    await query(`
      ALTER TABLE helpers
      ADD COLUMN IF NOT EXISTS name TEXT
    `);

    await query(`
      ALTER TABLE helpers
      ADD COLUMN IF NOT EXISTS profile_photo_url TEXT
    `);

    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'helpers'::regclass
          AND contype = 'p'
        ) THEN
          ALTER TABLE helpers
          ADD CONSTRAINT helpers_pkey PRIMARY KEY (id);
        END IF;
      END
      $$;
    `);

    await query(`
      INSERT INTO helpers (name)
      SELECT $1
      WHERE NOT EXISTS (
        SELECT 1 FROM helpers WHERE name = $1
      )
    `, ["Test Helper"]);

    console.log("Helpers table fixed ✅");
  } catch (err) {
    console.error("Error fixing helpers table:", err);
  } finally {
    process.exit();
  }
}

run();
