import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import stripeRoutes from "./routes/stripe";
import helperRoutes from "./routes/helpers";
import trackingRoutes from "./routes/tracking";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const activeJobs = new Map<string, any>();

app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "RoadShare API" });
});

app.use("/api/stripe", stripeRoutes);
app.use("/api/helpers", helperRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/helpers", helperRoutes);
app.use("/tracking", trackingRoutes);

app.get("/stripe/onboarding-return", (_req, res) => {
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 30px;">
        <h2>Returning to RoadShare...</h2>
        <script>window.location.href = "roadshare://helper-dashboard";</script>
        <a href="roadshare://helper-dashboard">Tap here to return to RoadShare</a>
      </body>
    </html>
  `);
});

app.get("/", (_req, res) => {
  res.send("RoadShare backend is running");
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("user:join", (payload, callback) => {
    const role = payload?.role || "unknown";
    const jobId = payload?.jobId;

    socket.join(role);

    if (jobId) {
      socket.join(`job:${jobId}`);
    }

    console.log("user:join", { socketId: socket.id, role, jobId });

    callback?.({ ok: true, socketId: socket.id, role, jobId });

    if (role === "helper") {
      const jobs = Array.from(activeJobs.values()).filter(
        (job) => job.status === "searching"
      );

      jobs.forEach((job) => {
        socket.emit("job:available", job);
      });
    }
  });

  socket.on("job:create", (payload, callback) => {
    const jobId = `job_${Date.now()}`;

    const job = {
      id: jobId,
      jobId,
      serviceType: payload?.serviceType || "Roadside Assistance",
      vehicleType: payload?.vehicleType || "",
      note: payload?.note || "",
      customerName: payload?.customerName || "Customer",
      customerLocation: payload?.location || payload?.customerLocation || null,
      customerAddress: payload?.location?.address || payload?.customerAddress || "Current Location",
      status: "searching",
      paymentStatus: "unpaid",
      quoteCents: payload?.quoteCents || 6500,
      createdAt: new Date().toISOString(),
    };

    activeJobs.set(jobId, job);

    socket.join("customer");
    socket.join(`job:${jobId}`);

    console.log("job:create", job);

    io.to("helper").emit("job:available", job);
    io.emit("job:available_debug", job);

    socket.emit("job:created", job);

    callback?.({
      ok: true,
      id: jobId,
      jobId,
      job,
    });
  });

  socket.on("job:accept", (payload, callback) => {
    const jobId = payload?.jobId;

    if (!jobId) {
      callback?.({ ok: false, error: "jobId required" });
      return;
    }

    const existing = activeJobs.get(jobId) || {};

    const acceptedJob = {
      ...existing,
      id: jobId,
      jobId,
      status: "accepted",
      paymentStatus: existing.paymentStatus || "unpaid",
      helperProfile: {
        helperId: payload?.helperId || "7",
        name: payload?.helperName || "RoadShare Helper",
        phone: payload?.helperPhone || "",
      },
      etaMinutes: payload?.etaMinutes || 8,
    };

    activeJobs.set(jobId, acceptedJob);

    socket.join("helper");
    socket.join(`job:${jobId}`);

    console.log("job:accept", acceptedJob);

    io.to(`job:${jobId}`).emit("job:accepted", acceptedJob);
    io.emit("job:accepted_debug", acceptedJob);

    callback?.({ ok: true, job: acceptedJob });
  });

  socket.on("location:update", (payload) => {
    console.log("location:update", payload);
    const jobId = payload?.jobId;
    if (!jobId) return;

    const update = {
      jobId,
      helperLocation: {
        latitude: payload.latitude,
        longitude: payload.longitude,
      },
      heading: payload.heading || 0,
      updatedAt: new Date().toISOString(),
    };

    io.to(`job:${jobId}`).emit("tracking:update", update);
  });

  socket.on("job:update_status", (payload, callback) => {
    const jobId = payload?.jobId;
    const status = payload?.status;

    if (!jobId || !status) {
      callback?.({ ok: false, error: "jobId and status required" });
      return;
    }

    const existing = activeJobs.get(jobId) || {};

    const job = {
      ...existing,
      id: jobId,
      jobId,
      status,
      etaMinutes: status === "arrived" ? 0 : existing.etaMinutes || 8,
      paymentStatus: existing.paymentStatus || "paid",
      helperProfile: existing.helperProfile || {
        helperId: payload?.helperId || "7",
        name: payload?.helperName || "RoadShare Helper",
        phone: payload?.helperPhone || "",
      },
    };

    activeJobs.set(jobId, job);

    io.to(`job:${jobId}`).emit("job:status_updated", job);

    callback?.({ ok: true, job });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RoadShare backend running with Socket.IO on http://0.0.0.0:${PORT}`);
});

