import "dotenv/config";
import express from "express";
import cors from "cors";
import stripeRoutes from "./routes/stripe";
import helperRoutes from "./routes/helpers";
import trackingRoutes from "./routes/tracking";

const app = express();

app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" })
);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "RoadShare API" });
});

// API routes
app.use("/api/stripe", stripeRoutes);
app.use("/api/helpers", helperRoutes);
app.use("/api/tracking", trackingRoutes);

// Mobile fallback routes because app is calling /helpers/...
app.use("/helpers", helperRoutes);
app.use("/tracking", trackingRoutes);

app.get("/", (_req, res) => {
  res.send("🚗 RoadShare backend is running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 RoadShare backend running on http://0.0.0.0:${PORT}`);
});
