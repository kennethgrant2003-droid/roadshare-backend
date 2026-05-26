import express from "express";
import Stripe from "stripe";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

router.post("/create-payment-intent", async (req, res) => {
  try {
    const { amountCents, currency = "usd", paymentType = "job" } = req.body;

    if (!amountCents || amountCents < 50) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        paymentType,
        roadshare: "true",
      },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error: any) {
    console.error("Stripe payment intent error:", error);
    res.status(500).json({ error: error.message || "Stripe error" });
  }
});

export default router;
