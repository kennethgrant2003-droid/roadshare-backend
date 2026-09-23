import { Router } from "express";
import { getFirestore, getFirebaseAuth } from "../firebaseAdmin";

const router = Router();

router.post("/submit", async (req, res) => {
  try {
    const authorization = String(req.headers.authorization || "");
    if (!authorization.startsWith("Bearer ")) return res.status(401).json({ ok: false, error: "Sign in to rate your helper." });
    const decoded = await getFirebaseAuth().verifyIdToken(authorization.slice(7));
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

    const db = getFirestore();

    const ratingRef = db.collection("ratings").doc(jobId);
    const statsRef = db.collection("helperRatings").doc(helperId);
    const jobRef = db.collection("roadshareJobs").doc(jobId);

    let avgRating = rating;
    let ratingCount = 1;

    await db.runTransaction(async (transaction) => {
      const job = await transaction.get(jobRef);
      const assignment = job.data();
      if (assignment?.customerId !== decoded.uid || assignment?.helperId !== helperId || assignment?.status !== "completed") {
        throw new Error("RATING_NOT_ALLOWED");
      }
      const existingRating = await transaction.get(ratingRef);

      if (existingRating.exists) {
        throw new Error("DUPLICATE_RATING");
      }

      const statsSnapshot = await transaction.get(statsRef);

      const currentCount =
        Number(statsSnapshot.data()?.ratingCount || 0);

      const currentTotal =
        Number(statsSnapshot.data()?.ratingTotal || 0);

      ratingCount = currentCount + 1;
      const ratingTotal = currentTotal + rating;

      avgRating =
        Math.round((ratingTotal / ratingCount) * 10) / 10;

      transaction.set(ratingRef, {
        jobId,
        helperId,
        rating,
        review,
        createdAt: new Date().toISOString(),
      });

      transaction.set(
        statsRef,
        {
          helperId,
          ratingCount,
          ratingTotal,
          avgRating,
          updatedAt: new Date().toISOString(),
        },
        {
          merge: true,
        }
      );
    });

    console.log("[RoadShare Ratings] Firestore rating submitted:", {
      jobId,
      helperId,
      rating,
      avgRating,
      ratingCount,
    });

    return res.json({
      ok: true,
      rating,
      avgRating,
      ratingCount,
    });
  } catch (error: any) {
    if (error?.message === "RATING_NOT_ALLOWED") return res.status(403).json({ ok: false, error: "Only the customer can rate a completed job." });
    if (error?.message === "DUPLICATE_RATING") {
      return res.status(409).json({
        ok: false,
        error: "A rating has already been submitted for this job",
      });
    }

    console.error("[RoadShare Ratings] Firestore error:", error);

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

    const db = getFirestore();

    const snapshot = await db
      .collection("helperRatings")
      .doc(helperId)
      .get();

    const data = snapshot.data();

    return res.json({
      ok: true,
      helperId,
      avgRating: Number(data?.avgRating || 0),
      ratingCount: Number(data?.ratingCount || 0),
    });
  } catch (error) {
    console.error("[RoadShare Ratings] Firestore lookup error:", error);

    return res.status(500).json({
      ok: false,
      error: "Could not load helper rating",
    });
  }
});

export default router;
