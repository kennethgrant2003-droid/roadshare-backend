"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.one = one;
exports.many = many;
require("dotenv/config");
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.warn("[db] DATABASE_URL is missing. Postgres queries will fail until it is set.");
}
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
});
async function query(text, params = []) {
    const result = await exports.pool.query(text, params);
    return result;
}
async function one(text, params = []) {
    const result = await query(text, params);
    return result.rows[0] || null;
}
async function many(text, params = []) {
    const result = await query(text, params);
    return result.rows;
}
