import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import Stripe from "stripe";
import { query } from "../db";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadBufferToCloudinary(buffer: Buffer, helperId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "roadshare/helpers",
        public_id: `helper_${helperId}_${Date.now()}`,
        resource_type: "image",
        overwrite: true,
        transformation: [
          { width: 600, height: 600, crop: "fill", gravity: "face" },
          { quality: "auto", fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error || new Error("Cloudinary upload failed"));
          return;
        }

        resolve(result.secure_url);
      }
    );

    stream.end(buffer);
  });
}

async function ensureHelperColumns() {
  await query(`
    ALTER TABLE helpers
    ADD COLUMN IF NOT EXISTS profile_photo_url TEXT
  `);

  await query(`
    ALTER TABLE helpers
    ADD COLUMN IF NOT EXISTS stripe_account_id TEXT
  `);

  await query(`
    ALTER TABLE helpers
    ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE
  `);
}

router.get("/", async (_req, res) => {
  try {
    await ensureHelperColumns();

    const result = await query(`
      SELECT id, name, profile_photo_url, stripe_account_id, stripe_onboarding_complete
      FROM helpers
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:helperId/profile-picture", upload.single("profilePicture"), async (req, res) => {
  try {
    await ensureHelperColumns();

    const { helperId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: "profilePicture file is required" });
    }

    const imageUrl = await uploadBufferToCloudinary(req.file.buffer, helperId);

    const result = await query(
      `
      UPDATE helpers
      SET profile_photo_url = $1
      WHERE id = $2
      RETURNING id, name, profile_photo_url, stripe_account_id, stripe_onboarding_complete
      `,
      [imageUrl, helperId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Helper not found" });
    }

    res.json({ ok: true, helper: result.rows[0] });
  } catch (error: any) {
    console.error("Helper profile picture upload failed:", error);
    res.status(500).json({
      error: error.message || "Helper profile picture upload failed",
    });
  }
});

router.post("/:helperId/stripe/onboard", async (req, res) => {
  try {
    await ensureHelperColumns();

    const { helperId } = req.params;
    const { email } = req.body;

    const helperResult = await query(
      "SELECT id, name, stripe_account_id FROM helpers WHERE id = $1",
      [helperId]
    );

    if (helperResult.rowCount === 0) {
      return res.status(404).json({ error: "Helper not found" });
    }

    const helper = helperResult.rows[0];

    let stripeAccountId = helper.stripe_account_id;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email,
        metadata: {
          helperId: String(helperId),
          helperName: helper.name || "",
          app: "RoadShare",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;

      await query(
        `
        UPDATE helpers
        SET stripe_account_id = $1
        WHERE id = $2
        `,
        [stripeAccountId, helperId]
      );
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: "https://roadshare-backend.onrender.com/health",
      return_url: "https://roadshare-backend.onrender.com/health",
      type: "account_onboarding",
    });

    res.json({
      ok: true,
      stripeAccountId,
      onboardingUrl: accountLink.url,
    });
  } catch (error: any) {
    console.error("Stripe onboarding failed:", error);
    res.status(500).json({ error: error.message || "Stripe onboarding failed" });
  }
});

router.get("/:helperId/stripe/status", async (req, res) => {
  try {
    await ensureHelperColumns();

    const { helperId } = req.params;

    const helperResult = await query(
      "SELECT id, stripe_account_id FROM helpers WHERE id = $1",
      [helperId]
    );

    if (helperResult.rowCount === 0) {
      return res.status(404).json({ error: "Helper not found" });
    }

    const stripeAccountId = helperResult.rows[0].stripe_account_id;

    if (!stripeAccountId) {
      return res.json({
        ok: true,
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
    }

    const account = await stripe.accounts.retrieve(stripeAccountId);

    const complete = Boolean(account.charges_enabled && account.payouts_enabled);

    await query(
      `
      UPDATE helpers
      SET stripe_onboarding_complete = $1
      WHERE id = $2
      `,
      [complete, helperId]
    );

    res.json({
      ok: true,
      connected: true,
      stripeAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      onboardingComplete: complete,
      requirements: account.requirements?.currently_due || [],
    });
  } catch (error: any) {
    console.error("Stripe status failed:", error);
    res.status(500).json({ error: error.message || "Stripe status failed" });
  }
});

export default router;
