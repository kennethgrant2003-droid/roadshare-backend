"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const stripe_1 = __importDefault(require("stripe"));
const router = express_1.default.Router();
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
router.post("/payments/create-intent", async (req, res) => {
    try {
        const { amountCents, customerEmail, jobId } = req.body;
        if (!amountCents) {
            return res.status(400).json({
                error: "amountCents is required",
            });
        }
        const customer = await stripe.customers.create({
            email: customerEmail || undefined,
            metadata: {
                app: "RoadShare",
            },
        });
        const ephemeralKey = await stripe.ephemeralKeys.create({ customer: customer.id }, { apiVersion: "2025-04-30.basil" });
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: "usd",
            customer: customer.id,
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                app: "RoadShare",
                jobId: jobId || "",
            },
        });
        res.json({
            paymentIntent: paymentIntent.client_secret,
            ephemeralKey: ephemeralKey.secret,
            customer: customer.id,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        });
    }
    catch (error) {
        console.error("Stripe payment error:", error);
        res.status(500).json({
            error: error.message || "Stripe payment failed",
        });
    }
});
router.post("/webhook", async (req, res) => {
    res.json({ received: true });
});
exports.default = router;
