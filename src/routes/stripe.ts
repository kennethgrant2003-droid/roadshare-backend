import express from "express";
import Stripe from "stripe";

const router = express.Router();

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY on RoadShare backend.");
  }

  return new Stripe(secretKey);
}

router.post("/create-payment-intent", async (req, res) => {
  try {
    const stripe = getStripe();

    const rawAmount =
      req.body?.amountCents ??
      req.body?.amount ??
      req.body?.quoteCents;

    const amountCents = Number(rawAmount);

    if (
      !Number.isFinite(amountCents) ||
      !Number.isInteger(amountCents) ||
      amountCents < 50
    ) {
      return res.status(400).json({
        error: "Invalid payment amount.",
      });
    }

    const currency = String(req.body?.currency || "usd").toLowerCase();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        app: "RoadShare",
        paymentType: String(req.body?.paymentType || "job"),
        serviceType: String(
          req.body?.serviceType || "Roadside Assistance"
        ),
      },
    });

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntent: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amountCents,
      currency,
    });
  } catch (error: any) {
    console.error("Stripe payment intent error:", error);

    return res.status(500).json({
      error: error?.message || "Stripe payment error.",
    });
  }
});

router.post("/payments/create-intent", async (req, res) => {
  try {
    const stripe = getStripe();

    const rawAmount =
      req.body?.amountCents ??
      req.body?.amount ??
      req.body?.quoteCents;

    const amountCents = Number(rawAmount);

    if (
      !Number.isFinite(amountCents) ||
      !Number.isInteger(amountCents) ||
      amountCents < 50
    ) {
      return res.status(400).json({
        error: "Invalid payment amount.",
      });
    }

    const currency = String(req.body?.currency || "usd").toLowerCase();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        app: "RoadShare",
        paymentType: String(req.body?.paymentType || "job"),
        serviceType: String(
          req.body?.serviceType || "Roadside Assistance"
        ),
      },
    });

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntent: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amountCents,
      currency,
    });
  } catch (error: any) {
    console.error("Stripe payment intent error:", error);

    return res.status(500).json({
      error: error?.message || "Stripe payment error.",
    });
  }
});

export default router;