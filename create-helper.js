const { query } = require("./src/db");

async function run() {
  try {
    await query("INSERT INTO helpers (name) VALUES ($1)", ["Test Helper"]);
    console.log("Helper created ✅");
  } catch (err) {
    console.error("Error creating helper:", err);
  } finally {
    process.exit();
  }
}

run();
