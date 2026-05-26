const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({ ok: true, service: "RoadShare backend", status: "running" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "RoadShare backend", status: "healthy" });
});

app.post("/api/stripe/create-payment-intent", async (req, res) => {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;

    if (!stripeSecret) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY on backend." });
    }

    const stripe = new Stripe(stripeSecret);

    const amount =
      Number(req.body?.amount) ||
      Number(req.body?.amountCents) ||
      Number(req.body?.quoteCents) ||
      7500;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        app: "RoadShare",
        service: req.body?.serviceType || "roadside",
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("[stripe create-payment-intent]", error);
    res.status(500).json({
      error: error?.message || "Could not create payment intent.",
    });
  }
});

app.post("/api/stripe/payments/create-intent", async (req, res) => {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;

    if (!stripeSecret) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY on backend." });
    }

    const stripe = new Stripe(stripeSecret);

    const amount =
      Number(req.body?.amount) ||
      Number(req.body?.amountCents) ||
      Number(req.body?.quoteCents) ||
      7500;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        app: "RoadShare",
        service: req.body?.serviceType || "roadside",
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("[stripe payments create-intent]", error);
    res.status(500).json({
      error: error?.message || "Could not create payment intent.",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RoadShare backend running on port ${PORT}`);
});
