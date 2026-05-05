import express from "express";
import { query } from "../db";
import Stripe from "stripe";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// CREATE HELPER ACCOUNT
router.post("/create", async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email required" });
    }

    // create helper in DB
    const result = await query(
      `
      INSERT INTO helpers (name)
      VALUES ($1)
      RETURNING id, name
      `,
      [name]
    );

    const helper = result.rows[0];

    // create Stripe connected account (IMPORTANT)
    const account = await stripe.accounts.create({
      type: "express",
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    // save stripe account
    await query(
      `
      UPDATE helpers
      SET stripe_account_id = $1
      WHERE id = $2
      `,
      [account.id, helper.id]
    );

    res.json({
      ok: true,
      helperId: helper.id,
      stripeAccountId: account.id,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET HELPERS
router.get("/", async (req, res) => {
  const result = await query("SELECT * FROM helpers ORDER BY id DESC");
  res.json(result.rows);
});

export default router;
