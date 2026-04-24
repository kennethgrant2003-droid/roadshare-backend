import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.routes";
import helperRoutes from "./routes/helper.routes";
import jobRoutes from "./routes/job.routes";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "Road Share API running" });
});

app.use("/auth", authRoutes);
app.use("/helper", helperRoutes);
app.use("/jobs", jobRoutes);

export default app;