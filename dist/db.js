"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.closeDb = closeDb;
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.warn("[db] DATABASE_URL is missing. Postgres queries will fail until it is set.");
}
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false,
    },
});
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await exports.pool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.NODE_ENV !== "production") {
            console.log("[db] query completed", { duration, rows: result.rowCount });
        }
        return result;
    }
    catch (error) {
        console.error("[db] query failed:", error);
        throw error;
    }
}
async function closeDb() {
    await exports.pool.end();
}
