import "dotenv/config";

import express from "express";
import cors from "cors";
import http from "http";
import { randomUUID } from "crypto";

import {
  Server,
} from "socket.io";

import stripeRoutes from "./routes/stripe";
import ratingRoutes from "./routes/ratings";
import verificationRoutes from "./routes/verification";
import accountRoutes from "./routes/account";
import jobsRoutes from "./routes/jobs";

import {
  getFirestore,
  getFirebaseAuth,
} from "./firebaseAdmin";

import {
  verifyRoadSharePayment,
} from "./services/roadsharePayments";
import { getQuotedService } from "./services/pricing";

const app =
  express();

const server =
  http.createServer(app);

const io =
  new Server(server, {
    cors: {
      origin: "*",
      methods: [
        "GET",
        "POST",
      ],
    },
  });

type RoadShareJob = {
  id: string;
  jobId: string;

  serviceType: string;
  vehicleType: string;
  note: string;

  customerName: string;
  customerId: string;

  customerLocation: {
    latitude?: number;
    longitude?: number;
    address?: string;
  } | null;

  customerAddress: string;

  status: string;
  paymentStatus: string;

  quoteCents: number;

  paymentIntentId?: string;

  helperProfile?: {
    helperId?: string;
    name?: string;
    phone?: string;
    vehicle?: string;
  };

  helperLocation?: { latitude: number; longitude: number; updatedAt: string };

  etaMinutes?: number;

  createdAt: string;
  updatedAt?: string;
};

const activeJobs =
  new Map<
    string,
    RoadShareJob
  >();
const lastLocationSave = new Map<string, number>();

// Rooms and mutating socket events must use the verified Firebase identity.
io.use(async (socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token || "");
    if (!token) throw new Error("Authentication required");
    const decoded = await getFirebaseAuth().verifyIdToken(token);
    const user = await getFirestore().collection("users").doc(decoded.uid).get();
    const role = String(user.data()?.role || "").toLowerCase();
    if (!["customer", "helper", "admin"].includes(role)) {
      throw new Error("RoadShare account role required");
    }
    socket.data.uid = decoded.uid;
    socket.data.role = role;
    next();
  } catch {
    next(new Error("RoadShare sign-in required"));
  }
});

async function loadJob(jobId: string): Promise<RoadShareJob | null> {
  const cached = activeJobs.get(jobId);
  if (cached) return cached;
  const snapshot = await getFirestore().collection("roadshareJobs").doc(jobId).get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as RoadShareJob;
  if (job) activeJobs.set(jobId, job);
  return job || null;
}

/* =========================================================
   EXPRESS
========================================================= */

app.use(
  "/api/stripe/webhook",
  express.raw({
    type:
      "application/json",
  })
);

app.use(cors());
app.use(
  express.json()
);

app.get(
  "/health",
  (_req, res) => {
    res.json({
      ok: true,
      app:
        "RoadShare API",
    });
  }
);

app.use(
  "/api/stripe",
  stripeRoutes
);

app.use(
  "/api/ratings",
  ratingRoutes
);

app.use(
  "/api/verification",
  verificationRoutes
);
app.use(
  "/api/account",
  accountRoutes
);

app.use(
  "/api/jobs",
  jobsRoutes
);

app.use(
  "/ratings",
  ratingRoutes
);

app.get(
  "/stripe/onboarding-return",
  (_req, res) => {
    res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body style="background:#000;color:#fff;font-family:Arial;padding:30px;text-align:center;">
          <h2>Returning to RoadShare...</h2>

          <script>
            window.location.href =
              "roadshare://helper-dashboard";
          </script>

          <a
            style="color:#ff1010;font-size:20px;"
            href="roadshare://helper-dashboard"
          >
            Tap here to return to RoadShare
          </a>
        </body>
      </html>
    `);
  }
);

app.get(
  "/stripe/onboarding-return-active",
  (_req, res) => {
    res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body style="background:#000;color:#fff;font-family:Arial;padding:30px;text-align:center;">
          <h2>Stripe setup received.</h2>
          <p>Returning to your RoadShare job...</p>

          <script>
            window.location.href =
              "roadshare://helper-active-job";
          </script>

          <a
            style="color:#ff1010;font-size:20px;"
            href="roadshare://helper-active-job"
          >
            Return to Active Job
          </a>
        </body>
      </html>
    `);
  }
);

app.get(
  "/",
  (_req, res) => {
    res.send(
      "RoadShare backend is running"
    );
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
  "connection",
  (socket) => {
    console.log(
      "[RoadShare Socket] connected:",
      socket.id
    );

    /* =====================================================
       USER JOIN
    ===================================================== */

    socket.on("user:join", async (payload: any, callback?: (response: any) => void) => {
      try {
        const { uid, role } = socket.data as { uid: string; role: string };
        if (payload?.role && payload.role !== role) throw new Error("Invalid account role");
        if (payload?.userId && payload.userId !== uid) throw new Error("Invalid account ID");
        if (role === "helper") {
          const helperUser = await getFirestore().collection("users").doc(uid).get();
          if (String(helperUser.data()?.verification_status || "").toLowerCase() !== "approved") {
            throw new Error("Helper verification required.");
          }
        }
        socket.join(role);
        socket.join(`user:${uid}`);
        if (payload?.jobId) {
          const jobId = String(payload.jobId);
          const job = await loadJob(jobId);
          if (!job || (role !== "admin" && job.customerId !== uid && job.helperProfile?.helperId !== uid)) {
            throw new Error("This job is not assigned to your account");
          }
          socket.join(`job:${jobId}`);
        }
        callback?.({ ok: true, role, userId: uid });
        if (role === "helper") {
          const waiting = await getFirestore().collection("roadshareJobs")
            .where("status", "==", "searching").get();
          waiting.docs.forEach((doc) => socket.emit("job:available", doc.data()));
        }
      } catch (error: any) {
        callback?.({ ok: false, error: error.message });
      }
    });

    /* =====================================================
       JOB ROOM JOIN / LEAVE
    ===================================================== */

    socket.on("job:join", async (payload: any, callback?: (response: any) => void) => {
      try {
        const jobId = String(payload?.jobId || "");
        if (!jobId) throw new Error("jobId required");
        const job = await loadJob(jobId);
        const { uid, role } = socket.data as { uid: string; role: string };
        if (!job || (role !== "admin" && job.customerId !== uid && job.helperProfile?.helperId !== uid)) {
          throw new Error("This job is not assigned to your account");
        }
        socket.join(`job:${jobId}`);
        callback?.({ ok: true, jobId });
      } catch (error: any) {
        callback?.({ ok: false, error: error.message });
      }
    });

    socket.on("job:leave", (payload: any) => {
      const jobId = String(payload?.jobId || "");
      if (jobId) socket.leave(`job:${jobId}`);
    });

    /* =====================================================
       CREATE PAID JOB
    ===================================================== */

    socket.on(
      "job:create",
      async (
        payload: any,
        callback?:
          (
            response: any
          ) => void
      ) => {
        try {
          const jobId = `job_${randomUUID()}`;

          const firebaseToken =
            String(
              payload
                ?.firebaseToken ||
              ""
            ).trim();

          if (!firebaseToken) {
            callback?.({
              ok: false,
              error:
                "Customer authentication is required before dispatch.",
            });

            return;
          }

          const decodedCustomer =
            await getFirebaseAuth()
              .verifyIdToken(
                firebaseToken
              );

          const customerId =
            String(
              decodedCustomer.uid ||
              ""
            ).trim();

          if (!customerId) {
            callback?.({
              ok: false,
              error:
                "RoadShare could not verify the customer account.",
            });

            return;
          }

          if (socket.data.role !== "customer" || socket.data.uid !== customerId) {
            callback?.({ ok: false, error: "Sign in as the customer who paid for this request." });
            return;
          }

          const customerUserSnapshot =
            await getFirestore()
              .collection("users")
              .doc(customerId)
              .get();

          const customerRole =
            String(
              customerUserSnapshot
                .data()
                ?.role ||
              ""
            )
              .trim()
              .toLowerCase();

          if (
            customerRole !==
            "customer"
          ) {
            callback?.({
              ok: false,
              error:
                "A customer account is required to request RoadShare service.",
            });

            return;
          }
          const quoteCents =
            Number(
              payload
                ?.quoteCents
            );

          if (
            !Number.isFinite(
              quoteCents
            ) ||
            quoteCents <
              50
          ) {
            callback?.({
              ok: false,
              error:
                "Invalid RoadShare job amount.",
            });

            return;
          }

          const finalQuote =
            Math.round(
              quoteCents
            );
          const serviceQuote = getQuotedService(payload?.serviceType);
          if (!serviceQuote || finalQuote !== serviceQuote.amountCents) {
            callback?.({ ok: false, error: "The paid amount does not match this RoadShare service." });
            return;
          }

          const paymentStatus =
            String(
              payload
                ?.paymentStatus ||
                ""
            )
              .trim()
              .toLowerCase();

          const paymentIntentId =
            String(
              payload
                ?.paymentIntentId ||
                ""
            ).trim();

          if (
            paymentStatus !==
            "paid"
          ) {
            callback?.({
              ok: false,
              error:
                "RoadShare dispatch requires confirmed payment.",
            });

            return;
          }

          /*
           * Never trust the phone saying "paid".
           * Stripe itself must confirm the PaymentIntent.
           */
          const verifiedPayment = await verifyRoadSharePayment(
            paymentIntentId,
            finalQuote,
            customerId
          );
          if (verifiedPayment.metadata?.serviceType !== serviceQuote.serviceType) {
            throw new Error("Stripe payment service does not match the requested job.");
          }

          const db = getFirestore();
          const prior = await db.collection("roadshareJobs")
            .where("paymentIntentId", "==", paymentIntentId).limit(1).get();
          if (!prior.empty) {
            const oldJob = prior.docs[0].data() as RoadShareJob;
            if (oldJob.customerId !== customerId) throw new Error("This payment belongs to another request.");
            callback?.({ ok: true, id: oldJob.id, jobId: oldJob.jobId, job: oldJob });
            return;
          }

          const customerLocation =
            payload
              ?.location ||
            payload
              ?.customerLocation ||
            null;

          const job:
            RoadShareJob =
            {
              id: jobId,
              jobId,

              serviceType:
                serviceQuote.serviceType,

              vehicleType:
                payload
                  ?.vehicleType ||
                "",

              note:
                payload
                  ?.note ||
                "",

              customerName:
                payload
                  ?.customerName ||
                "Customer",

              customerId,

              customerLocation,

              customerAddress:
                customerLocation
                  ?.address ||
                payload
                  ?.customerAddress ||
                "Current Location",

              status:
                "searching",

              paymentStatus:
                "paid",

              quoteCents:
                finalQuote,

              paymentIntentId,

              createdAt:
                new Date()
                  .toISOString(),
            };

          /*
           * Persist the payment/job relationship.
           * This survives a Render restart.
           */
          await db.runTransaction(async (transaction) => {
            const reservation = db.collection("paymentDispatches").doc(paymentIntentId);
            const claim = await transaction.get(reservation);
            if (claim.exists) throw new Error("This payment has already been dispatched. Reopen your active request.");
            transaction.create(reservation, { customerId, jobId, createdAt: job.createdAt });
            transaction.create(db.collection("roadshareJobs").doc(jobId), {
              ...job, helperId: null, payoutStatus: "not_started",
            });
          });

          activeJobs.set(
            jobId,
            job
          );

          socket.join(
            "customer"
          );

          socket.join(
            `job:${jobId}`
          );

          console.log(
            "[RoadShare Socket] job:create",
            {
              ...job,
              paymentIntentId:
                paymentIntentId,
            }
          );

          io
            .to("helper")
            .emit(
              "job:available",
              job
            );

          socket.emit(
            "job:created",
            job
          );

          callback?.({
            ok: true,
            id:
              jobId,
            jobId,
            job,
          });
        } catch (
          error: any
        ) {
          console.error(
            "[RoadShare Socket] job:create error",
            error
          );

          callback?.({
            ok: false,
            error:
              error?.message ||
              "Could not create RoadShare dispatch.",
          });
        }
      }
    );

    /* =====================================================
       ACCEPT JOB
    ===================================================== */

    socket.on(
      "job:accept",
      async (
        payload: any,
        callback?:
          (
            response: any
          ) => void
      ) => {
        try {
        const jobId =
          payload?.jobId
            ? String(
                payload.jobId
              )
            : "";

        if (!jobId) {
          callback?.({
            ok: false,
            error:
              "jobId required",
          });

          return;
        }

        if (socket.data.role !== "helper" || payload?.helperId !== socket.data.uid) {
          callback?.({ ok: false, error: "An authenticated helper account is required." });
          return;
        }

        const existing = await loadJob(jobId);

        if (!existing) {
          callback?.({
            ok: false,
            error:
              "Job was not found or is no longer available.",
          });

          return;
        }

        if (
          existing.status !==
          "searching"
        ) {
          callback?.({
            ok: false,
            error:
              "This RoadShare request has already been accepted.",
          });

          return;
        }

        const helperId = socket.data.uid as string;

        if (!helperId) {
          callback?.({
            ok: false,
            error:
              "Helper ID is required.",
          });

          return;
        }

        const assigned = await getFirestore().collection("roadshareJobs")
          .where("helperId", "==", helperId).get();
        if (assigned.docs.some((doc) => doc.id !== jobId &&
          ["accepted", "assigned", "enroute", "en_route", "arrived", "in_progress"].includes(String(doc.data().status)))) {
          callback?.({ ok: false, error: "Complete your current job before accepting another." });
          return;
        }

        const helperUser = await getFirestore().collection("users").doc(helperId).get();
        if (String(helperUser.data()?.verification_status || "").toLowerCase() !== "approved") {
          callback?.({ ok: false, error: "Helper verification is required before accepting jobs." });
          return;
        }
        const helperProfile = await getFirestore().collection("helperProfiles").doc(helperId).get();
        const profile = helperProfile.data() || {};
        if (!profile.name || !profile.phone || !profile.vehicle) {
          callback?.({ ok: false, error: "Complete your helper profile before accepting jobs." });
          return;
        }

        const acceptedJob:
          RoadShareJob =
          {
            ...existing,

            id: jobId,
            jobId,

            status:
              "accepted",

            helperProfile: {
              helperId,

              name: String(profile.name),

              phone: String(profile.phone),

              vehicle: String(profile.vehicle),
            },

            etaMinutes:
              Number(
                payload
                  ?.etaMinutes
              ) > 0
                ? Number(
                    payload
                      .etaMinutes
                  )
                : 8,

            updatedAt:
              new Date()
                .toISOString(),
          };

        try {
          const db = getFirestore();
          await db.runTransaction(async (transaction) => {
            const ref = db.collection("roadshareJobs").doc(jobId);
            const latest = await transaction.get(ref);
            if (latest.data()?.status !== "searching") throw new Error("This request was already accepted.");
            transaction.set(ref,
              {
                status:
                  "accepted",

                helperId,

                helperProfile:
                  acceptedJob
                    .helperProfile,

                etaMinutes:
                  acceptedJob
                    .etaMinutes,

                updatedAt:
                  acceptedJob
                    .updatedAt,
              },
              {
                merge: true,
              }
            );
          });
        } catch (
          error: any
        ) {
          console.error(
            "[RoadShare Socket] Could not persist acceptance:",
            error
          );

          callback?.({
            ok: false,
            error:
              "RoadShare could not securely record the helper assignment.",
          });

          return;
        }

        activeJobs.set(
          jobId,
          acceptedJob
        );

        socket.join(
          "helper"
        );

        socket.join(
          `job:${jobId}`
        );

        console.log(
          "[RoadShare Socket] job:accept",
          acceptedJob
        );

        io
          .to(
            `job:${jobId}`
          )
          .emit(
            "job:accepted",
            acceptedJob
          );

        io
          .to("helper")
          .emit(
            "job:unavailable",
            {
              jobId,
            }
          );

        callback?.({
          ok: true,
          job:
            acceptedJob,
        });
        } catch (error) {
          console.error("[RoadShare] helper acceptance failed:", error);
          callback?.({ ok: false, error: "Could not accept this job. Please retry." });
        }
      }
    );

    /* =====================================================
       HELPER LOCATION
    ===================================================== */

    socket.on(
      "location:update",
      async (
        payload: any
      ) => {
        const jobId =
          payload?.jobId
            ? String(
                payload.jobId
              )
            : "";

        if (!jobId) {
          return;
        }

        try {
          const job = await loadJob(jobId);
          if (socket.data.role !== "helper" || job?.helperProfile?.helperId !== socket.data.uid ||
            ["completed", "cancelled"].includes(job.status)) return;
        } catch { return; }

        const latitude =
          Number(
            payload
              ?.latitude ??
              payload
                ?.lat
          );

        const longitude =
          Number(
            payload
              ?.longitude ??
              payload
                ?.lng
          );

        if (
          Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
          !Number.isFinite(
            latitude
          ) ||
          !Number.isFinite(
            longitude
          )
        ) {
          return;
        }

        const update = {
          jobId,

          helperUserId: socket.data.uid,

          latitude,
          longitude,

          lat:
            latitude,

          lng:
            longitude,

          heading:
            Number(
              payload
                ?.heading
            ) || 0,

          timestamp:
            new Date()
              .toISOString(),
        };

        io
          .to(
            `job:${jobId}`
          )
          .emit(
            "tracking:update",
            update
          );

        if (Date.now() - (lastLocationSave.get(jobId) || 0) >= 15000) {
          lastLocationSave.set(jobId, Date.now());
          getFirestore().collection("roadshareJobs").doc(jobId).set({
            helperLocation: { latitude, longitude, updatedAt: update.timestamp },
          }, { merge: true }).catch((error) => {
            lastLocationSave.delete(jobId);
            console.error("[RoadShare] helper location save failed:", error);
          });
        }
      }
    );

    /* =====================================================
       JOB STATUS
    ===================================================== */

    socket.on(
      "job:update_status",
      async (
        payload: any,
        callback?:
          (
            response: any
          ) => void
      ) => {
        try {
        const jobId =
          payload?.jobId
            ? String(
                payload.jobId
              )
            : "";

        const status =
          payload?.status
            ? String(
                payload.status
              )
            : "";

        if (
          !jobId ||
          !status
        ) {
          callback?.({
            ok: false,
            error:
              "jobId and status required",
          });

          return;
        }

        const existing = await loadJob(jobId);

        if (!existing) {
          callback?.({
            ok: false,
            error:
              "Job not found",
          });

          return;
        }

        if (socket.data.role !== "helper" || existing.helperProfile?.helperId !== socket.data.uid) {
          callback?.({ ok: false, error: "This job is not assigned to your helper account." });
          return;
        }

        const allowed: Record<string, string[]> = {
          accepted: ["enroute", "en_route", "arrived", "in_progress"],
          enroute: ["arrived", "in_progress"],
          en_route: ["arrived", "in_progress"],
          arrived: ["in_progress"],
          in_progress: [],
        };
        // Completion requires the authenticated Stripe payout endpoint.
        if (status === "completed") {
          const paid = await getFirestore().collection("roadshareJobs").doc(jobId).get();
          if (paid.data()?.status !== "completed") {
            callback?.({ ok: false, error: "Finish this job through the payout flow." });
            return;
          }
        } else if (!allowed[existing.status]?.includes(status)) {
          callback?.({ ok: false, error: "Invalid job status change." });
          return;
        }

        const job:
          RoadShareJob =
          {
            ...existing,

            status,

            etaMinutes:
              status ===
              "arrived"
                ? 0
                : Number(
                    payload
                      ?.etaMinutes ??
                    existing
                      .etaMinutes ??
                    8
                  ),

            updatedAt:
              new Date()
                .toISOString(),
          };

        /*
         * Status changes remain realtime UI events.
         * They DO NOT create Stripe transfers.
         */
        try {
          await getFirestore()
            .collection(
              "roadshareJobs"
            )
            .doc(jobId)
            .set(
              {
                status,

                etaMinutes:
                  job.etaMinutes,

                updatedAt:
                  job.updatedAt,
              },
              {
                merge: true,
              }
            );
        } catch (error) {
          console.error("[RoadShare] status persistence failed:", error);
          callback?.({ ok: false, error: "Could not save job status." });
          return;
        }

        activeJobs.set(jobId, job);

        console.log(
          "[RoadShare Socket] job:update_status",
          job
        );

        io
          .to(
            `job:${jobId}`
          )
          .emit(
            "job:status_updated",
            job
          );

        callback?.({
          ok: true,
          job,
        });
        } catch (error) {
          console.error("[RoadShare] job status update failed:", error);
          callback?.({ ok: false, error: "Could not update this job. Please retry." });
        }
      }
    );

    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on(
      "disconnect",
      (
        reason
      ) => {
        console.log(
          "[RoadShare Socket] disconnected:",
          socket.id,
          reason
        );
      }
    );
  }
);

/* =========================================================
   START SERVER
========================================================= */

const PORT =
  Number(
    process.env.PORT
  ) || 3000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `RoadShare backend running with Socket.IO on http://0.0.0.0:${PORT}`
    );
  }
);
