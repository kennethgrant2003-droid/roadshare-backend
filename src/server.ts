import "dotenv/config";
import Stripe from "stripe";

import express from "express";
import cors from "cors";
import http from "http";

import {
  Server,
} from "socket.io";

import stripeRoutes from "./routes/stripe";
import helperRoutes from "./routes/helpers";
import trackingRoutes from "./routes/tracking";
import ratingRoutes from "./routes/ratings";

import {
  getFirestore,
} from "./firebaseAdmin";

import {
  verifyRoadSharePayment,
} from "./services/roadsharePayments";

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

  etaMinutes?: number;

  createdAt: string;
  updatedAt?: string;
};

const activeJobs =
  new Map<
    string,
    RoadShareJob
  >();

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
  "/api/helpers",
  helperRoutes
);

app.use(
  "/api/tracking",
  trackingRoutes
);

app.use(
  "/api/ratings",
  ratingRoutes
);

app.use(
  "/helpers",
  helperRoutes
);

app.use(
  "/tracking",
  trackingRoutes
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

    socket.on(
      "user:join",
      (
        payload: any,
        callback?:
          (
            response: any
          ) => void
      ) => {
        const role =
          String(
            payload?.role ||
              "unknown"
          )
            .trim()
            .toLowerCase();

        const userId =
          payload?.userId
            ? String(
                payload.userId
              )
            : undefined;

        const jobId =
          payload?.jobId
            ? String(
                payload.jobId
              )
            : undefined;

        socket.join(
          role
        );

        if (userId) {
          socket.join(
            `user:${userId}`
          );
        }

        if (jobId) {
          socket.join(
            `job:${jobId}`
          );
        }

        console.log(
          "[RoadShare Socket] user:join",
          {
            socketId:
              socket.id,
            role,
            userId,
            jobId,
          }
        );

        callback?.({
          ok: true,
          socketId:
            socket.id,
          role,
          userId,
          jobId,
        });

        if (
          role ===
          "helper"
        ) {
          const jobs =
            Array.from(
              activeJobs.values()
            ).filter(
              (job) =>
                job.status ===
                "searching"
            );

          jobs.forEach(
            (job) => {
              socket.emit(
                "job:available",
                job
              );
            }
          );
        }
      }
    );

    /* =====================================================
       JOB ROOM JOIN / LEAVE
    ===================================================== */

    socket.on(
      "job:join",
      (
        payload: any,
        callback?:
          (
            response: any
          ) => void
      ) => {
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

        socket.join(
          `job:${jobId}`
        );

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
      (
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

        socket.leave(
          `job:${jobId}`
        );

        console.log(
          "[RoadShare Socket] left room:",
          `job:${jobId}`
        );
      }
    );

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
          const jobId =
            `job_${Date.now()}`;

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
          await verifyRoadSharePayment(
            paymentIntentId,
            finalQuote
          );

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
                payload
                  ?.serviceType ||
                "Roadside Assistance",

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
          await getFirestore()
            .collection(
              "roadshareJobs"
            )
            .doc(jobId)
            .set({
              ...job,

              helperId:
                null,

              payoutStatus:
                "not_started",
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

        const existing =
          activeJobs.get(
            jobId
          );

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

        const helperId =
          String(
            payload
              ?.helperId ||
              ""
          ).trim();

        if (!helperId) {
          callback?.({
            ok: false,
            error:
              "Helper ID is required.",
          });

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

              name:
                payload
                  ?.helperName ||
                "RoadShare Helper",

              phone:
                payload
                  ?.helperPhone ||
                "",

              vehicle:
                payload
                  ?.helperVehicle ||
                "",
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
          await getFirestore()
            .collection(
              "roadshareJobs"
            )
            .doc(jobId)
            .set(
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
      }
    );

    /* =====================================================
       HELPER LOCATION
    ===================================================== */

    socket.on(
      "location:update",
      (
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

          helperUserId:
            payload
              ?.helperUserId ||
            payload
              ?.helperId ||
            undefined,

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

        const existing =
          activeJobs.get(
            jobId
          );

        if (!existing) {
          callback?.({
            ok: false,
            error:
              "Job not found",
          });

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

        activeJobs.set(
          jobId,
          job
        );

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
        } catch (
          error
        ) {
          console.log(
            "[RoadShare] status persistence warning:",
            error
          );
        }

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

