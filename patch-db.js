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

add("ALTER TABLE jobs ADD COLUMN helper_id TEXT");
add("ALTER TABLE helpers ADD COLUMN helper_id TEXT");
add("ALTER TABLE helper_accounts ADD COLUMN bio TEXT DEFAULT ''");

console.log("done");
