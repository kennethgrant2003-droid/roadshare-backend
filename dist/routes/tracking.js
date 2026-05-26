"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const router = express_1.default.Router();
router.post("/jobs/:jobId/location", async (req, res) => {
    try {
        const { jobId } = req.params;
        const { role, latitude, longitude } = req.body;
        if (!jobId || !role || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                error: "jobId, role, latitude, and longitude are required",
            });
        }
        if (role !== "customer" && role !== "helper") {
            return res.status(400).json({
                error: "role must be customer or helper",
            });
        }
        await (0, db_1.query)(`
      CREATE TABLE IF NOT EXISTS job_locations (
        job_id TEXT PRIMARY KEY,
        customer_lat DOUBLE PRECISION,
        customer_lng DOUBLE PRECISION,
        helper_lat DOUBLE PRECISION,
        helper_lng DOUBLE PRECISION,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        if (role === "customer") {
            await (0, db_1.query)(`
        INSERT INTO job_locations (job_id, customer_lat, customer_lng, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (job_id)
        DO UPDATE SET
          customer_lat = EXCLUDED.customer_lat,
          customer_lng = EXCLUDED.customer_lng,
          updated_at = NOW()
        `, [jobId, latitude, longitude]);
        }
        else {
            await (0, db_1.query)(`
        INSERT INTO job_locations (job_id, helper_lat, helper_lng, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (job_id)
        DO UPDATE SET
          helper_lat = EXCLUDED.helper_lat,
          helper_lng = EXCLUDED.helper_lng,
          updated_at = NOW()
        `, [jobId, latitude, longitude]);
        }
        res.json({ ok: true });
    }
    catch (err) {
        console.error("Location update failed:", err);
        res.status(500).json({ error: err.message });
    }
});
router.get("/jobs/:jobId/location", async (req, res) => {
    try {
        const { jobId } = req.params;
        await (0, db_1.query)(`
      CREATE TABLE IF NOT EXISTS job_locations (
        job_id TEXT PRIMARY KEY,
        customer_lat DOUBLE PRECISION,
        customer_lng DOUBLE PRECISION,
        helper_lat DOUBLE PRECISION,
        helper_lng DOUBLE PRECISION,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        const result = await (0, db_1.query)(`
      SELECT *
      FROM job_locations
      WHERE job_id = $1
      `, [jobId]);
        res.json({
            ok: true,
            location: result.rows[0] || null,
        });
    }
    catch (err) {
        console.error("Location fetch failed:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
