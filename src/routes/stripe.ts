import express from "express";
import Stripe from "stripe";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const PLATFORM_FEE_PERCENT = 50;

async function notifyBoss(data: {
  jobId: string;
  helperName?: string;
  helperStripeAccountId: string;
  amountCents: number;
  platformFeeCents: number;
  helperPayoutCents: number;
}) {
  console.log("🔔 BOSS NOTIFICATION");
  console.log(`Job ID: ${data.jobId}`);
  console.log(`Helper: ${data.helperName || "Unknown helper"}`);
  console.log(`Helper Stripe Account: ${data.helperStripeAccountId}`);
  console.log(`Total paid: $${(data.amountCents / 100).toFixed(2)}`);
  console.log(`Company 50%: $${(data.platformFeeCents / 100).toFixed(2)}`);
  console.log(`Helper 50%: $${(data.helperPayoutCents / 100).toFixed(2)}`);
}

router.post("/payments/create-intent", async (req, res) => {
  try {
    const {
      amountCents,
      customerEmail,
      jobId,
      helperStripeAccountId,
      helperName,
    } = req.body;

    if (!amountCents || !jobId || !helperStripeAccountId) {
      return res.status(400).json({
        error: "amountCents, jobId, and helperStripeAccountId are required",
      });
    }

    const helperAccount = await stripe.accounts.retrieve(helperStripeAccountId);

    if (!helperAccount.charges_enabled || !helperAccount.payouts_enabled) {
      return res.status(400).json({
        error: "Helper Stripe account is not ready for payments or payouts.",
        details: helperAccount.requirements?.currently_due || [],
      });
    }

    const applicationFeeAmount = Math.round(
      amountCents * (PLATFORM_FEE_PERCENT / 100)
    );

    const customer = await stripe.customers.create({
      email: customerEmail,
      metadata: {
        app: "RoadShare",
      },
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2025-04-30.basil" }
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customer.id,
      automatic_payment_methods: {
        enabled: true,
      },
      application_fee_amount: applicationFeeAmount,
      transfer_data: {
        destination: helperStripeAccountId,
      },
      metadata: {
        app: "RoadShare",
        jobId,
        helperName: helperName || "",
        split: "50/50",
        platformFeeCents: String(applicationFeeAmount),
        helperPayoutCents: String(amountCents - applicationFeeAmount),
        helperStripeAccountId,
      },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      platformFeeCents: applicationFeeAmount,
      helperPayoutCents: amountCents - applicationFeeAmount,
    });
  } catch (error: any) {
    console.error("Stripe payment error:", error);
    res.status(500).json({
      error: error.message || "Stripe payment failed",
    });
  }
});

router.post("/webhook", async (req, res) => {
  let event: Stripe.Event;

  try {
    const signature = req.headers["stripe-signature"] as string;

    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (error: any) {
    console.error("Webhook signature failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    await notifyBoss({
      jobId: paymentIntent.metadata.jobId,
      helperName: paymentIntent.metadata.helperName,
      helperStripeAccountId: paymentIntent.metadata.helperStripeAccountId,
      amountCents: paymentIntent.amount,
      platformFeeCents: Number(paymentIntent.metadata.platformFeeCents || 0),
      helperPayoutCents: Number(paymentIntent.metadata.helperPayoutCents || 0),
    });
  }

  res.json({ received: true });
});

export default router;
