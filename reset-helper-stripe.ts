import "dotenv/config";
import { query, closeDb } from "./src/db";

async function main() {
  await query(`
    UPDATE helpers
    SET stripe_account_id = NULL,
        stripe_onboarding_complete = FALSE
  `);

  console.log("? Cleared old helper Stripe accounts. Connect Stripe again to create fresh accounts.");
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
