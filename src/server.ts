import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import stripeRoutes from "./routes/stripe";
import helperRoutes from "./routes/helpers";
import trackingRoutes from "./routes/tracking";
import ratingRoutes from "./routes/ratings";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

type RoadShareJob = {
  id: string;
  jobId: string;

  serviceType: string;
  vehicleType: string;
  note: string;

  customerName: string;
  customerLocation: {
    latitude?: number;
    longitude?: number;
    address?: string;
  } | null;

  customerAddress: string;

  status: string;
  paymentStatus: string;

  quoteCents: number;

  helperProfile?: {
    helperId?: string;
    name?: string;
    phone?: string;
    vehicle?: string;
  };

  etaMinutes?: number;

  createdAt: string;
  updatedAt?: string;
};

const activeJobs = new Map<string, RoadShareJob>();

/* =========================================================
   EXPRESS
========================================================= */

app.use(
  "/api/stripe/webhook",
  express.raw({
    type: "application/json",
  })
);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "RoadShare API",
  });
});

app.use("/api/stripe", stripeRoutes);

app.use("/api/helpers", helperRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/api/ratings", ratingRoutes);

app.use("/helpers", helperRoutes);
app.use("/tracking", trackingRoutes);
app.use("/ratings", ratingRoutes);

app.get("/stripe/onboarding-return", (_req, res) => {
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 30px;">
        <h2>Returning to RoadShare...</h2>

        <script>
          window.location.href =
            "roadshare://helper-dashboard";
        </script>

        <a href="roadshare://helper-dashboard">
          Tap here to return to RoadShare
        </a>
      </body>
    </html>
  `);
});

app.get("/", (_req, res) => {
  res.send("RoadShare backend is running");
});

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {
  console.log(
    "[RoadShare Socket] connected:",
    socket.id
  );

  /* =======================================================
     USER JOIN
  ======================================================= */

  socket.on(
    "user:join",
    (
      payload: any,
      callback?: (response: any) => void
    ) => {
      const role =
        String(payload?.role || "unknown")
          .trim()
          .toLowerCase();

      const userId =
        payload?.userId
          ? String(payload.userId)
          : undefined;

      const jobId =
        payload?.jobId
          ? String(payload.jobId)
          : undefined;

      socket.join(role);

      if (userId) {
        socket.join(`user:${userId}`);
      }

      if (jobId) {
        socket.join(`job:${jobId}`);
      }

      console.log("[RoadShare Socket] user:join", {
        socketId: socket.id,
        role,
        userId,
        jobId,
      });

      callback?.({
        ok: true,
        socketId: socket.id,
        role,
        userId,
        jobId,
      });

      /*
       * A helper who comes online should immediately
       * receive all currently-searching RoadShare jobs.
       */
      if (role === "helper") {
        const jobs =
          Array.from(activeJobs.values()).filter(
            (job) => job.status === "searching"
          );

        jobs.forEach((job) => {
          socket.emit(
            "job:available",
            job
          );
        });
      }
    }
  );

  /* =======================================================
     JOB ROOM JOIN / LEAVE
  ======================================================= */

  socket.on(
    "job:join",
    (
      payload: any,
      callback?: (response: any) => void
    ) => {
      const jobId =
        payload?.jobId
          ? String(payload.jobId)
          : "";

      if (!jobId) {
        callback?.({
          ok: false,
          error: "jobId required",
        });

        return;
      }

      socket.join(`job:${jobId}`);

      console.log(
        "[RoadShare Socket] joined room:",
        `job:${jobId}`
      );

      callback?.({
        ok: true,
        jobId,
      });
    }
  );

  socket.on(
    "job:leave",
    (payload: any) => {
      const jobId =
        payload?.jobId
          ? String(payload.jobId)
          : "";

      if (!jobId) return;

      socket.leave(`job:${jobId}`);

      console.log(
        "[RoadShare Socket] left room:",
        `job:${jobId}`
      );
    }
  );

  /* =======================================================
     CREATE JOB
  ======================================================= */

  socket.on(
    "job:create",
    (
      payload: any,
      callback?: (response: any) => void
    ) => {
      const jobId =
        `job_${Date.now()}`;

      const quoteCents =
        Number(payload?.quoteCents);

      const customerLocation =
        payload?.location ||
        payload?.customerLocation ||
        null;

      const job: RoadShareJob = {
        id: jobId,
        jobId,

        serviceType:
          payload?.serviceType ||
          "Roadside Assistance",

        vehicleType:
          payload?.vehicleType || "",

        note:
          payload?.note || "",

        customerName:
          payload?.customerName ||
          "Customer",

        customerLocation,

        customerAddress:
          customerLocation?.address ||
          payload?.customerAddress ||
          "Current Location",

        status: "searching",

        paymentStatus:
          payload?.paymentStatus ||
          "paid",

        quoteCents:
          Number.isFinite(quoteCents) &&
          quoteCents >= 50
            ? Math.round(quoteCents)
            : 6500,

        createdAt:
          new Date().toISOString(),
      };

      activeJobs.set(
        jobId,
        job
      );

      /*
       * The customer who created the request becomes
       * a member of this job's realtime room.
       */
      socket.join("customer");
      socket.join(`job:${jobId}`);

      console.log(
        "[RoadShare Socket] job:create",
        job
      );

      /*
       * Only online helpers in the helper room receive
       * the customer request.
       */
      io.to("helper").emit(
        "job:available",
        job
      );

      socket.emit(
        "job:created",
        job
      );

      callback?.({
        ok: true,
        id: jobId,
        jobId,
        job,
      });
    }
  );

  /* =======================================================
     ACCEPT JOB
  ======================================================= */

  socket.on(
    "job:accept",
    (
      payload: any,
      callback?: (response: any) => void
    ) => {
      const jobId =
        payload?.jobId
          ? String(payload.jobId)
          : "";

      if (!jobId) {
        callback?.({
          ok: false,
          error: "jobId required",
        });

        return;
      }

      const existing =
        activeJobs.get(jobId);

      if (!existing) {
        callback?.({
          ok: false,
          error:
            "Job was not found or is no longer available.",
        });

        return;
      }

      /*
       * Prevent two helpers from accepting the same request.
       */
      if (
        existing.status !== "searching"
      ) {
        callback?.({
          ok: false,
          error:
            "This RoadShare request has already been accepted.",
        });

        return;
      }

      const acceptedJob: RoadShareJob = {
        ...existing,

        id: jobId,
        jobId,

        status: "accepted",

        helperProfile: {
          helperId:
            payload?.helperId ||
            socket.id,

          name:
            payload?.helperName ||
            "RoadShare Helper",

          phone:
            payload?.helperPhone ||
            "",

          vehicle:
            payload?.helperVehicle ||
            "",
        },

        etaMinutes:
          Number(payload?.etaMinutes) > 0
            ? Number(payload.etaMinutes)
            : 8,

        updatedAt:
          new Date().toISOString(),
      };

      activeJobs.set(
        jobId,
        acceptedJob
      );

      socket.join("helper");
      socket.join(`job:${jobId}`);

      console.log(
        "[RoadShare Socket] job:accept",
        acceptedJob
      );

      /*
       * Customer + accepting helper both receive this.
       */
      io.to(`job:${jobId}`).emit(
        "job:accepted",
        acceptedJob
      );

      /*
       * Remove the request from other helpers'
       * available-job screens.
       */
      io.to("helper").emit(
        "job:unavailable",
        {
          jobId,
        }
      );

      callback?.({
        ok: true,
        job: acceptedJob,
      });
    }
  );

  /* =======================================================
     HELPER LOCATION
  ======================================================= */

  socket.on(
    "location:update",
    (payload: any) => {
      const jobId =
        payload?.jobId
          ? String(payload.jobId)
          : "";

      if (!jobId) return;

      const latitude =
        Number(
          payload?.latitude ??
          payload?.lat
        );

      const longitude =
        Number(
          payload?.longitude ??
          payload?.lng
        );

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        return;
      }

      const update = {
        jobId,

        helperUserId:
          payload?.helperUserId ||
          payload?.helperId ||
          undefined,

        latitude,
        longitude,

        lat: latitude,
        lng: longitude,

        heading:
          Number(payload?.heading) || 0,

        timestamp:
          new Date().toISOString(),
      };

      console.log(
        "[RoadShare Socket] location:update",
        update
      );

      /*
       * One canonical server event:
       * tracking:update
       */
      io.to(`job:${jobId}`).emit(
        "tracking:update",
        update
      );
    }
  );

  /* =======================================================
     JOB STATUS
  ======================================================= */

  socket.on(
    "job:update_status",
    (
      payload: any,
      callback?: (response: any) => void
    ) => {
      const jobId =
        payload?.jobId
          ? String(payload.jobId)
          : "";

      const status =
        payload?.status
          ? String(payload.status)
          : "";

      if (!jobId || !status) {
        callback?.({
          ok: false,
          error:
            "jobId and status required",
        });

        return;
      }

      const existing =
        activeJobs.get(jobId);

      if (!existing) {
        callback?.({
          ok: false,
          error: "Job not found",
        });

        return;
      }

      const job: RoadShareJob = {
        ...existing,

        status,

        etaMinutes:
          status === "arrived"
            ? 0
            : Number(
                payload?.etaMinutes ??
                existing.etaMinutes ??
                8
              ),

        updatedAt:
          new Date().toISOString(),
      };

      activeJobs.set(
        jobId,
        job
      );

      console.log(
        "[RoadShare Socket] job:update_status",
        job
      );

      /*
       * One canonical server event:
       * job:status_updated
       */
      io.to(`job:${jobId}`).emit(
        "job:status_updated",
        job
      );

      callback?.({
        ok: true,
        job,
      });
    }
  );

  /* =======================================================
     DISCONNECT
  ======================================================= */

  socket.on(
    "disconnect",
    (reason) => {
      console.log(
        "[RoadShare Socket] disconnected:",
        socket.id,
        reason
      );
    }
  );
});

/* =========================================================
   START SERVER
========================================================= */

const PORT =
  Number(process.env.PORT) ||
  3000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `RoadShare backend running with Socket.IO on http://0.0.0.0:${PORT}`
    );
  }
);
