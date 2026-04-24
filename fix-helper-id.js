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

console.log("JOBS COLUMNS BEFORE:");
console.log(db.prepare("PRAGMA table_info(jobs)").all());

console.log("HELPERS COLUMNS BEFORE:");
console.log(db.prepare("PRAGMA table_info(helpers)").all());

add("ALTER TABLE jobs ADD COLUMN helper_id TEXT");
add("ALTER TABLE helpers ADD COLUMN helper_id TEXT");

console.log("JOBS COLUMNS AFTER:");
console.log(db.prepare("PRAGMA table_info(jobs)").all());

console.log("HELPERS COLUMNS AFTER:");
console.log(db.prepare("PRAGMA table_info(helpers)").all());

console.log("done");
