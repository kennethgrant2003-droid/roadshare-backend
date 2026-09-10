import Stripe from "stripe";

export function getStripe() {
  const secretKey =
    process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "Missing STRIPE_SECRET_KEY on RoadShare backend."
    );
  }

  return new Stripe(secretKey);
}

export async function verifyRoadSharePayment(
  paymentIntentId: string,
  expectedAmountCents: number
) {
  if (!paymentIntentId) {
    throw new Error(
      "Missing Stripe PaymentIntent ID."
    );
  }

  const stripe =
    getStripe();

  const paymentIntent =
    await stripe.paymentIntents.retrieve(
      paymentIntentId
    );

  if (
    paymentIntent.metadata?.app !==
    "RoadShare"
  ) {
    throw new Error(
      "Payment does not belong to RoadShare."
    );
  }

  if (
    paymentIntent.status !==
    "succeeded"
  ) {
    throw new Error(
      `Stripe payment is not complete. Current status: ${paymentIntent.status}`
    );
  }

  if (
    paymentIntent.currency !==
    "usd"
  ) {
    throw new Error(
      "RoadShare currently requires USD payments."
    );
  }

  if (
    paymentIntent.amount !==
    expectedAmountCents
  ) {
    throw new Error(
      "Stripe payment amount does not match the RoadShare job."
    );
  }

  if (
    paymentIntent.amount_received <
    expectedAmountCents
  ) {
    throw new Error(
      "Stripe has not received the full RoadShare payment."
    );
  }

  return paymentIntent;
}
