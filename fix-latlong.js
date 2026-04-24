const Database = require("better-sqlite3");
const db = new Database("roadshare.db");

function add(sql) {
  try {
    db.prepare(sql).run();
    console.log("OK:", sql);
  } catch (e) {
    console.log("SKIP:", e.message);
  }
}

// FIX missing columns
add("ALTER TABLE helpers ADD COLUMN latitude REAL");
add("ALTER TABLE helpers ADD COLUMN longitude REAL");
add("ALTER TABLE helpers ADD COLUMN heading REAL DEFAULT 0");

add("ALTER TABLE customers ADD COLUMN latitude REAL");
add("ALTER TABLE customers ADD COLUMN longitude REAL");

add("ALTER TABLE jobs ADD COLUMN customer_latitude REAL");
add("ALTER TABLE jobs ADD COLUMN customer_longitude REAL");

console.log("done");
