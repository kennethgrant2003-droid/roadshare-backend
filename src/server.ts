import "dotenv/config";
import express from "express";
import cors from "cors";
import stripeRoutes from "./routes/stripe";
import helperRoutes from "./routes/helpers";

const app = express();

// 🔥 Stripe webhook MUST come BEFORE express.json()
app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" })
);

// Normal middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "RoadShare API" });
});

// Routes
app.use("/api/stripe", stripeRoutes);
app.use("/api/helpers", helperRoutes);

// Root
app.get("/", (_req, res) => {
  res.send("🚗 RoadShare backend is running");
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 RoadShare backend running on http://0.0.0.0:${PORT}`);
});

