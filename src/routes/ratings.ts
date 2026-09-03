import { Router } from "express";
import { query } from "../db";

const router = Router();

async function ensureRatingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ratings (
      id BIGSERIAL PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      helper_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      review TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_ratings_helper_id
    ON ratings(helper_id)
  `);
}

router.post("/submit", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "").trim();
    const helperId = String(req.body?.helperId || "").trim();
    const rating = Number(req.body?.rating);
    const review = String(req.body?.review || "").trim();

    if (!jobId) {
      return res.status(400).json({
        ok: false,
        error: "jobId is required",
      });
    }

    if (!helperId) {
      return res.status(400).json({
        ok: false,
        error: "helperId is required",
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        ok: false,
        error: "Rating must be an integer between 1 and 5",
      });
    }

    await ensureRatingsTable();

    const existing = await query(
      `
      SELECT id
      FROM ratings
      WHERE job_id = $1
      LIMIT 1
      `,
      [jobId]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        error: "A rating has already been submitted for this job",
      });
    }

    await query(
      `
      INSERT INTO ratings (
        job_id,
        helper_id,
        rating,
        review
      )
      VALUES ($1, $2, $3, $4)
      `,
      [
        jobId,
        helperId,
        rating,
        review,
      ]
    );

    const stats = await query(
      `
      SELECT
        ROUND(AVG(rating)::numeric, 1) AS avg_rating,
        COUNT(*)::int AS rating_count
      FROM ratings
      WHERE helper_id = $1
      `,
      [helperId]
    );

    const avgRating =
      Number(stats.rows?.[0]?.avg_rating) || rating;

    const ratingCount =
      Number(stats.rows?.[0]?.rating_count) || 1;

    console.log("[RoadShare Ratings] submitted:", {
      jobId,
      helperId,
      rating,
      review,
      avgRating,
      ratingCount,
    });

    return res.json({
      ok: true,
      rating,
      avgRating,
      ratingCount,
    });
  } catch (error) {
    console.error("[RoadShare Ratings] error:", error);

    return res.status(500).json({
      ok: false,
      error: "Could not submit rating",
    });
  }
});

router.get("/helper/:helperId", async (req, res) => {
  try {
    const helperId = String(req.params.helperId || "").trim();

    if (!helperId) {
      return res.status(400).json({
        ok: false,
        error: "helperId is required",
      });
    }

    await ensureRatingsTable();

    const stats = await query(
      `
      SELECT
        ROUND(AVG(rating)::numeric, 1) AS avg_rating,
        COUNT(*)::int AS rating_count
      FROM ratings
      WHERE helper_id = $1
      `,
      [helperId]
    );

    return res.json({
      ok: true,
      helperId,
      avgRating:
        Number(stats.rows?.[0]?.avg_rating) || 0,
      ratingCount:
        Number(stats.rows?.[0]?.rating_count) || 0,
    });
  } catch (error) {
    console.error("[RoadShare Ratings] helper stats error:", error);

    return res.status(500).json({
      ok: false,
      error: "Could not load helper rating",
    });
  }
});

export default router;
