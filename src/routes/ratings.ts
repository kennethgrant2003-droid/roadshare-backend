import { Router } from "express";

const router = Router();

type RatingRecord = {
  jobId: string;
  helperId: string;
  rating: number;
  review: string;
  createdAt: string;
};

const ratings: RatingRecord[] = [];

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

    if (
      !Number.isFinite(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return res.status(400).json({
        ok: false,
        error: "Rating must be between 1 and 5",
      });
    }

    const duplicate = ratings.find(
      (item) => item.jobId === jobId
    );

    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "A rating has already been submitted for this job",
      });
    }

    const record: RatingRecord = {
      jobId,
      helperId,
      rating,
      review,
      createdAt: new Date().toISOString(),
    };

    ratings.push(record);

    const helperRatings = ratings.filter(
      (item) => item.helperId === helperId
    );

    const average =
      helperRatings.reduce(
        (sum, item) => sum + item.rating,
        0
      ) / helperRatings.length;

    const avgRating =
      Math.round(average * 10) / 10;

    console.log(
      "[RoadShare Ratings] submitted:",
      record
    );

    return res.json({
      ok: true,
      rating,
      avgRating,
      ratingCount: helperRatings.length,
    });
  } catch (error) {
    console.error(
      "[RoadShare Ratings] error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Could not submit rating",
    });
  }
});

export default router;
