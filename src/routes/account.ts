import express from "express";

import {
  getFirebaseAuth,
  getFirestore,
} from "../firebaseAdmin";

import { query } from "../db";

const router = express.Router();

async function getAuthenticatedUser(
  req: express.Request
) {
  const authorization =
    String(
      req.headers.authorization || ""
    ).trim();

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    throw Object.assign(
      new Error(
        "Authentication required."
      ),
      { statusCode: 401 }
    );
  }

  const idToken =
    authorization
      .slice(7)
      .trim();

  if (!idToken) {
    throw Object.assign(
      new Error(
        "Authentication required."
      ),
      { statusCode: 401 }
    );
  }

  try {
    return await getFirebaseAuth()
      .verifyIdToken(idToken);
  } catch {
    throw Object.assign(
      new Error(
        "Invalid or expired authentication token."
      ),
      { statusCode: 401 }
    );
  }
}

router.delete(
  "/delete",
  async (req, res) => {
    try {
      const decoded =
        await getAuthenticatedUser(
          req
        );

      const uid =
        String(
          decoded.uid || ""
        ).trim();

      if (!uid) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Authentication required.",
          });
      }

      const auth =
        getFirebaseAuth();

      const db =
        getFirestore();

      let email =
        String(
          decoded.email || ""
        )
          .trim()
          .toLowerCase();

      try {
        const authUser =
          await auth.getUser(uid);

        email =
          String(
            authUser.email ||
              email
          )
            .trim()
            .toLowerCase();
      } catch {
        /*
         * Continue using the verified
         * token email if available.
         */
      }

      /*
       * Financial, transaction, service,
       * and historical records are
       * intentionally NOT deleted:
       *
       * helperPayouts
       * roadshareJobs
       * ratings
       * helperRatings
       * Stripe payment/payout records
       *
       * Those records may be required for
       * accounting, disputes, refunds,
       * fraud prevention, or legal records.
       */

      /*
       * RoadShare previously stored helper
       * accounts in a legacy PostgreSQL
       * database.
       *
       * Attempt to anonymize a matching
       * legacy helper record when that
       * database is available.
       *
       * The current RoadShare identity
       * system is Firebase. Therefore an
       * unavailable retired legacy database
       * must not prevent a user from deleting
       * their current RoadShare account.
       */
      if (email) {
        try {
          const legacyResult =
            await query(
              `
              UPDATE helpers
              SET
                name = $1,
                email = $2,
                phone = $3,
                password = $4,
                vehicle_type = $5,
                profile_photo_url = $6,
                socket_id = $7
              WHERE LOWER(email) = LOWER($8)
              `,
              [
                "Deleted RoadShare Helper",
                `deleted_${uid}@deleted.roadshare`,
                "",
                "",
                "",
                "",
                `deleted_${uid}`,
                email,
              ]
            );

          console.log(
            "[RoadShare Account] Legacy helper cleanup completed:",
            {
              uid,
              rows:
                legacyResult.rowCount,
            }
          );
        } catch (legacyError) {
          /*
           * Legacy PostgreSQL is no longer
           * authoritative for RoadShare
           * authentication.
           *
           * Log the failure for maintenance,
           * but continue deleting the active
           * Firebase account.
           */
          console.warn(
            "[RoadShare Account] Legacy helper cleanup unavailable; continuing Firebase deletion:",
            {
              uid,
              error:
                legacyError instanceof Error
                  ? legacyError.message
                  : String(
                      legacyError
                    ),
            }
          );
        }
      }

      /*
       * Remove current Firebase personal
       * and profile records.
       *
       * This intentionally does not delete
       * financial or historical records
       * listed above.
       */
      const batch =
        db.batch();

      batch.delete(
        db
          .collection("users")
          .doc(uid)
      );

      batch.delete(
        db
          .collection(
            "helperProfiles"
          )
          .doc(uid)
      );

      batch.delete(
        db
          .collection(
            "helperVerifications"
          )
          .doc(uid)
      );

      await batch.commit();

      /*
       * Delete Firebase Authentication LAST.
       *
       * This prevents removal of the login
       * identity before the active Firebase
       * profile cleanup has succeeded.
       */
      await auth.deleteUser(uid);

      console.log(
        "[RoadShare Account] Account deleted:",
        uid
      );

      return res.json({
        ok: true,
        deleted: true,
        message:
          "Your RoadShare account has been deleted.",
      });
    } catch (error: any) {
      console.error(
        "[RoadShare Account] Delete error:",
        error
      );

      const statusCode =
        Number(
          error?.statusCode
        ) || 500;

      return res
        .status(statusCode)
        .json({
          ok: false,
          error:
            statusCode === 401
              ? error.message
              : "Could not delete RoadShare account.",
        });
    }
  }
);

export default router;