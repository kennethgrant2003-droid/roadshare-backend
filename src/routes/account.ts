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
        // Continue using the verified
        // token email if available.
      }

      /*
       * Financial and transaction records
       * are intentionally NOT deleted:
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
       * Clean the legacy PostgreSQL helper
       * record BEFORE deleting Firebase
       * authentication.
       */
      if (email) {
        try {
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
        } catch (legacyError) {
          console.error(
            "[RoadShare Account] Legacy helper cleanup failed:",
            legacyError
          );

          return res
            .status(500)
            .json({
              ok: false,
              error:
                "Account cleanup could not be completed.",
            });
        }
      }

      /*
       * Remove Firebase personal/profile
       * records.
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