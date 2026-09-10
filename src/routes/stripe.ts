import express from "express";
import Stripe from "stripe";

import {
  getFirebaseAuth,
  getFirestore,
} from "../firebaseAdmin";

import {
  getStripe,
  verifyRoadSharePayment,
} from "../services/roadsharePayments";

const router =
  express.Router();

const DEFAULT_PUBLIC_URL =
  "https://roadshare-backend-1.onrender.com";

function getPublicUrl() {
  return String(
    process.env.ROADSHARE_PUBLIC_URL ||
      DEFAULT_PUBLIC_URL
  ).replace(/\/+$/, "");
}

function getBearerToken(
  req: express.Request
) {
  const header =
    req.headers.authorization || "";

  if (
    !header.startsWith(
      "Bearer "
    )
  ) {
    return "";
  }

  return header
    .substring(7)
    .trim();
}

async function getAuthenticatedHelper(
  req: express.Request
) {
  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error(
      "AUTH_REQUIRED"
    );
  }

  const decoded =
    await getFirebaseAuth()
      .verifyIdToken(token);

  const uid =
    decoded.uid;

  const db =
    getFirestore();

  const [
    userSnapshot,
    helperSnapshot,
  ] =
    await Promise.all([
      db
        .collection("users")
        .doc(uid)
        .get(),

      db
        .collection(
          "helperProfiles"
        )
        .doc(uid)
        .get(),
    ]);

  const role =
    String(
      userSnapshot.data()
        ?.role || ""
    )
      .trim()
      .toLowerCase();

  if (
    role !== "helper" &&
    !helperSnapshot.exists
  ) {
    throw new Error(
      "HELPER_REQUIRED"
    );
  }

  return {
    uid,
    email:
      decoded.email || "",
  };
}

function authErrorResponse(
  error: any,
  res: express.Response
) {
  if (
    error?.message ===
    "AUTH_REQUIRED"
  ) {
    res.status(401).json({
      ok: false,
      error:
        "Helper login required.",
    });

    return true;
  }

  if (
    error?.message ===
    "HELPER_REQUIRED"
  ) {
    res.status(403).json({
      ok: false,
      error:
        "A RoadShare helper account is required.",
    });

    return true;
  }

  return false;
}

async function createPaymentIntent(
  req: express.Request,
  res: express.Response
) {
  try {
    const stripe =
      getStripe();

    const rawAmount =
      req.body?.amountCents ??
      req.body?.amount ??
      req.body?.quoteCents;

    const amountCents =
      Number(rawAmount);

    if (
      !Number.isFinite(
        amountCents
      ) ||
      !Number.isInteger(
        amountCents
      ) ||
      amountCents < 50
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid payment amount.",
        });
    }

    const currency =
      String(
        req.body?.currency ||
          "usd"
      ).toLowerCase();

    if (
      currency !== "usd"
    ) {
      return res
        .status(400)
        .json({
          error:
            "RoadShare currently accepts USD only.",
        });
    }

    const paymentIntent =
      await stripe
        .paymentIntents
        .create({
          amount:
            amountCents,

          currency,

          automatic_payment_methods:
            {
              enabled: true,
            },

          metadata: {
            app:
              "RoadShare",

            paymentType:
              String(
                req.body
                  ?.paymentType ||
                  "job"
              ),

            serviceType:
              String(
                req.body
                  ?.serviceType ||
                  "Roadside Assistance"
              ),
          },
        });

    return res.json({
      clientSecret:
        paymentIntent
          .client_secret,

      paymentIntent:
        paymentIntent
          .client_secret,

      paymentIntentId:
        paymentIntent.id,

      amountCents,
      currency,
    });
  } catch (
    error: any
  ) {
    console.error(
      "Stripe payment intent error:",
      error
    );

    return res
      .status(500)
      .json({
        error:
          error?.message ||
          "Stripe payment error.",
      });
  }
}

router.post(
  "/create-payment-intent",
  createPaymentIntent
);

router.post(
  "/payments/create-intent",
  createPaymentIntent
);

/* =========================================================
   FIREBASE HELPER -> STRIPE CONNECT
========================================================= */

router.post(
  "/helper/connect/start",
  async (req, res) => {
    try {
      const helper =
        await getAuthenticatedHelper(
          req
        );

      const stripe =
        getStripe();

      const db =
        getFirestore();

      const payoutRef =
        db
          .collection(
            "helperPayouts"
          )
          .doc(helper.uid);

      const existing =
        await payoutRef.get();

      let stripeAccountId =
        String(
          existing.data()
            ?.stripeAccountId ||
            ""
        );

      if (
        stripeAccountId
      ) {
        try {
          await stripe
            .accounts
            .retrieve(
              stripeAccountId
            );
        } catch {
          stripeAccountId =
            "";
        }
      }

      if (
        !stripeAccountId
      ) {
        const account =
          await stripe
            .accounts
            .create({
              type:
                "express",

              country:
                "US",

              email:
                helper.email ||
                undefined,

              capabilities: {
                transfers: {
                  requested:
                    true,
                },
              },

              metadata: {
                app:
                  "RoadShare",

                firebaseUid:
                  helper.uid,
              },
            });

        stripeAccountId =
          account.id;

        await payoutRef.set(
          {
            helperId:
              helper.uid,

            stripeAccountId,

            createdAt:
              new Date()
                .toISOString(),

            onboardingComplete:
              false,
          },
          {
            merge: true,
          }
        );
      }

      const baseUrl =
        getPublicUrl();

      const link =
        await stripe
          .accountLinks
          .create({
            account:
              stripeAccountId,

            refresh_url:
              `${baseUrl}/stripe/onboarding-return-active`,

            return_url:
              `${baseUrl}/stripe/onboarding-return-active`,

            type:
              "account_onboarding",
          });

      return res.json({
        ok: true,
        stripeAccountId,
        onboardingUrl:
          link.url,
      });
    } catch (
      error: any
    ) {
      if (
        authErrorResponse(
          error,
          res
        )
      ) {
        return;
      }

      console.error(
        "Stripe helper onboarding error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error?.message ||
            "Could not start Stripe payout setup.",
        });
    }
  }
);

router.get(
  "/helper/connect/status",
  async (req, res) => {
    try {
      const helper =
        await getAuthenticatedHelper(
          req
        );

      const db =
        getFirestore();

      const payoutRef =
        db
          .collection(
            "helperPayouts"
          )
          .doc(helper.uid);

      const snapshot =
        await payoutRef.get();

      const stripeAccountId =
        String(
          snapshot.data()
            ?.stripeAccountId ||
            ""
        );

      if (
        !stripeAccountId
      ) {
        return res.json({
          ok: true,
          connected: false,
          onboardingComplete:
            false,
          payoutsEnabled:
            false,
        });
      }

      const stripe =
        getStripe();

      const account =
        await stripe
          .accounts
          .retrieve(
            stripeAccountId
          );

      const transfersActive =
        account.capabilities
          ?.transfers ===
        "active";

      const complete =
        Boolean(
          account
            .details_submitted &&
          account
            .payouts_enabled &&
          transfersActive
        );

      await payoutRef.set(
        {
          onboardingComplete:
            complete,

          payoutsEnabled:
            account
              .payouts_enabled,

          transfersActive,

          updatedAt:
            new Date()
              .toISOString(),
        },
        {
          merge: true,
        }
      );

      return res.json({
        ok: true,

        connected: true,

        stripeAccountId,

        onboardingComplete:
          complete,

        payoutsEnabled:
          account
            .payouts_enabled,

        transfersActive,

        requirements:
          account.requirements
            ?.currently_due ||
          [],
      });
    } catch (
      error: any
    ) {
      if (
        authErrorResponse(
          error,
          res
        )
      ) {
        return;
      }

      console.error(
        "Stripe helper status error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error?.message ||
            "Could not check Stripe payout status.",
        });
    }
  }
);

/* =========================================================
   SECURE 50/50 COMPLETION + PAYOUT
========================================================= */

router.post(
  "/jobs/:jobId/complete-and-payout",
  async (req, res) => {
    try {
      const helper =
        await getAuthenticatedHelper(
          req
        );

      const jobId =
        String(
          req.params.jobId ||
            ""
        ).trim();

      if (!jobId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "jobId is required.",
          });
      }

      const db =
        getFirestore();

      const jobRef =
        db
          .collection(
            "roadshareJobs"
          )
          .doc(jobId);

      const jobSnapshot =
        await jobRef.get();

      if (
        !jobSnapshot.exists
      ) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "RoadShare job was not found.",
          });
      }

      const job =
        jobSnapshot.data() ||
        {};

      const assignedHelperId =
        String(
          job.helperId ||
            job.helperProfile
              ?.helperId ||
            ""
        );

      if (
        assignedHelperId !==
        helper.uid
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "This job is assigned to a different helper.",
          });
      }

      if (
        job.payoutStatus ===
        "paid"
      ) {
        return res.json({
          ok: true,
          alreadyPaid: true,

          jobId,

          transferId:
            job.transferId ||
            "",

          helperPayoutCents:
            Number(
              job.helperPayoutCents ||
                0
            ),

          roadShareGrossCents:
            Number(
              job.roadShareGrossCents ||
                0
            ),
        });
      }

      if (
        job.payoutStatus ===
          "processing" ||
        job.payoutStatus ===
          "review_required"
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "This payout is already being processed or requires RoadShare review. A duplicate payout will not be created.",
          });
      }

      const paymentIntentId =
        String(
          job.paymentIntentId ||
            ""
        );

      const quoteCents =
        Number(
          job.quoteCents
        );

      if (
        !paymentIntentId ||
        !Number.isFinite(
          quoteCents
        ) ||
        quoteCents < 50
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "This RoadShare job does not contain valid payment information.",
          });
      }

      const paymentIntent =
        await verifyRoadSharePayment(
          paymentIntentId,
          Math.round(
            quoteCents
          )
        );

      const payoutSnapshot =
        await db
          .collection(
            "helperPayouts"
          )
          .doc(helper.uid)
          .get();

      const stripeAccountId =
        String(
          payoutSnapshot.data()
            ?.stripeAccountId ||
            ""
        );

      if (
        !stripeAccountId
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            code:
              "PAYOUT_SETUP_REQUIRED",
            error:
              "Complete Stripe payout setup before completing this job.",
          });
      }

      const stripe =
        getStripe();

      const account =
        await stripe
          .accounts
          .retrieve(
            stripeAccountId
          );

      if (
        !account.payouts_enabled ||
        account.capabilities
          ?.transfers !==
          "active"
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            code:
              "PAYOUT_SETUP_REQUIRED",
            error:
              "Your Stripe payout account is not ready yet. Finish payout setup first.",
          });
      }

      const amountReceived =
        paymentIntent
          .amount_received;

      const helperPayoutCents =
        Math.floor(
          amountReceived / 2
        );

      const roadShareGrossCents =
        amountReceived -
        helperPayoutCents;

      let claimed =
        false;

      await db.runTransaction(
        async (
          transaction
        ) => {
          const latest =
            await transaction.get(
              jobRef
            );

          const latestData =
            latest.data() ||
            {};

          if (
            latestData
              .payoutStatus ===
            "paid"
          ) {
            return;
          }

          if (
            latestData
              .payoutStatus ===
              "processing" ||
            latestData
              .payoutStatus ===
              "review_required"
          ) {
            throw new Error(
              "PAYOUT_LOCKED"
            );
          }

          transaction.set(
            jobRef,
            {
              payoutStatus:
                "processing",

              payoutHelperId:
                helper.uid,

              helperPayoutCents,

              roadShareGrossCents,

              payoutStartedAt:
                new Date()
                  .toISOString(),
            },
            {
              merge: true,
            }
          );

          claimed =
            true;
        }
      );

      if (!claimed) {
        const latest =
          await jobRef.get();

        const latestData =
          latest.data() ||
          {};

        return res.json({
          ok: true,
          alreadyPaid: true,
          jobId,

          transferId:
            latestData
              .transferId ||
            "",

          helperPayoutCents:
            Number(
              latestData
                .helperPayoutCents ||
                0
            ),

          roadShareGrossCents:
            Number(
              latestData
                .roadShareGrossCents ||
                0
            ),
        });
      }

      const latestCharge =
        paymentIntent
          .latest_charge;

      const chargeId =
        typeof latestCharge ===
        "string"
          ? latestCharge
          : latestCharge?.id;

      if (!chargeId) {
        await jobRef.set(
          {
            payoutStatus:
              "review_required",

            payoutError:
              "Stripe payment does not contain a charge ID.",

            updatedAt:
              new Date()
                .toISOString(),
          },
          {
            merge: true,
          }
        );

        return res
          .status(409)
          .json({
            ok: false,
            error:
              "Payment requires RoadShare review before payout.",
          });
      }

      try {
        const transfer =
          await stripe
            .transfers
            .create(
              {
                amount:
                  helperPayoutCents,

                currency:
                  paymentIntent
                    .currency,

                destination:
                  stripeAccountId,

                source_transaction:
                  chargeId,

                transfer_group:
                  jobId,

                metadata: {
                  app:
                    "RoadShare",

                  jobId,

                  helperId:
                    helper.uid,

                  paymentIntentId:
                    paymentIntent.id,

                  split:
                    "50_50",
                },
              },
              {
                idempotencyKey:
                  `roadshare-helper-50-${jobId}-${paymentIntent.id}`,
              }
            );

        await jobRef.set(
          {
            status:
              "completed",

            paymentStatus:
              "paid",

            payoutStatus:
              "paid",

            payoutHelperId:
              helper.uid,

            stripeAccountId,

            transferId:
              transfer.id,

            helperPayoutCents,

            roadShareGrossCents,

            paymentAmountCents:
              amountReceived,

            completedAt:
              new Date()
                .toISOString(),

            payoutCompletedAt:
              new Date()
                .toISOString(),

            updatedAt:
              new Date()
                .toISOString(),
          },
          {
            merge: true,
          }
        );

        return res.json({
          ok: true,

          alreadyPaid:
            false,

          jobId,

          paymentIntentId:
            paymentIntent.id,

          transferId:
            transfer.id,

          helperPayoutCents,

          roadShareGrossCents,

          split:
            "50/50",
        });
      } catch (
        transferError: any
      ) {
        /*
         * Fail closed.
         *
         * We intentionally DO NOT reset the payout
         * back to "not started". If Stripe received
         * the transfer but the network response was
         * interrupted, automatically retrying could
         * risk a duplicate after the idempotency
         * retention window.
         */
        await jobRef.set(
          {
            payoutStatus:
              "review_required",

            payoutError:
              String(
                transferError
                  ?.message ||
                  "Stripe transfer requires review."
              ).slice(
                0,
                500
              ),

            updatedAt:
              new Date()
                .toISOString(),
          },
          {
            merge: true,
          }
        );

        console.error(
          "RoadShare helper transfer error:",
          transferError
        );

        return res
          .status(500)
          .json({
            ok: false,

            code:
              "PAYOUT_REVIEW_REQUIRED",

            error:
              "RoadShare could not safely confirm the helper payout. The job has been locked for payout review to prevent a duplicate transfer.",
          });
      }
    } catch (
      error: any
    ) {
      if (
        authErrorResponse(
          error,
          res
        )
      ) {
        return;
      }

      if (
        error?.message ===
        "PAYOUT_LOCKED"
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "This payout is already being processed or requires RoadShare review.",
          });
      }

      console.error(
        "RoadShare completion payout error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            error?.message ||
            "Could not complete the RoadShare payout.",
        });
    }
  }
);

export default router;
