import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

import {
  getFirebaseAuth,
  getFirestore,
} from "../firebaseAdmin";

const router = express.Router();

const ROADSHARE_ADMIN_EMAIL =
  "roadshare.ga@gmail.com";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
  },
  fileFilter: (
    _req,
    file,
    callback
  ) => {
    if (
      !file.mimetype.startsWith(
        "image/"
      )
    ) {
      callback(
        new Error(
          "Only image files are allowed."
        )
      );

      return;
    }

    callback(null, true);
  },
});

cloudinary.config({
  cloud_name:
    process.env.CLOUDINARY_CLOUD_NAME,

  api_key:
    process.env.CLOUDINARY_API_KEY,

  api_secret:
    process.env.CLOUDINARY_API_SECRET,
});

type VerificationStatus =
  | "pending"
  | "approved"
  | "rejected";

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

async function getAuthenticatedUser(
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

  return decoded;
}

async function requireHelper(
  req: express.Request
) {
  const decoded =
    await getAuthenticatedUser(req);

  const db =
    getFirestore();

  const userSnapshot =
    await db
      .collection("users")
      .doc(decoded.uid)
      .get();

  const role =
    String(
      userSnapshot.data()
        ?.role || ""
    )
      .trim()
      .toLowerCase();

  if (
    !userSnapshot.exists ||
    role !== "helper"
  ) {
    throw new Error(
      "HELPER_REQUIRED"
    );
  }

  return {
    uid: decoded.uid,
    email:
      String(
        decoded.email || ""
      ),
  };
}

async function requireAdmin(
  req: express.Request
) {
  const decoded =
    await getAuthenticatedUser(req);

  const email =
    String(
      decoded.email || ""
    )
      .trim()
      .toLowerCase();

  if (
    email !==
    ROADSHARE_ADMIN_EMAIL
  ) {
    throw new Error(
      "ADMIN_REQUIRED"
    );
  }

  return {
    uid: decoded.uid,
    email,
  };
}

function sendAuthError(
  res: express.Response,
  error: any
) {
  const message =
    String(
      error?.message || ""
    );

  if (
    message ===
    "AUTH_REQUIRED"
  ) {
    res.status(401).json({
      ok: false,
      error:
        "Authentication required.",
    });

    return true;
  }

  if (
    message ===
    "HELPER_REQUIRED"
  ) {
    res.status(403).json({
      ok: false,
      error:
        "Helper access required.",
    });

    return true;
  }

  if (
    message ===
    "ADMIN_REQUIRED"
  ) {
    res.status(403).json({
      ok: false,
      error:
        "Administrator access required.",
    });

    return true;
  }

  return false;
}

async function uploadImage(
  buffer: Buffer,
  helperId: string,
  type: string
) {
  return new Promise<string>(
    (
      resolve,
      reject
    ) => {
      const stream =
        cloudinary.uploader
          .upload_stream(
            {
              folder:
                `roadshare/verification/${helperId}`,

              public_id:
                `${type}_${Date.now()}`,

              resource_type:
                "image",

              overwrite:
                true,

              transformation: [
                {
                  width: 1600,
                  height: 1600,
                  crop: "limit",
                },
                {
                  quality: "auto",
                  fetch_format: "auto",
                },
              ],
            },
            (
              error,
              result
            ) => {
              if (
                error ||
                !result?.secure_url
              ) {
                reject(
                  error ||
                    new Error(
                      "Verification upload failed."
                    )
                );

                return;
              }

              resolve(
                result.secure_url
              );
            }
          );

      stream.end(buffer);
    }
  );
}

/* =========================================================
   HELPER VERIFICATION SUBMISSION

   Authenticated helper only.

   Helper identity comes from the verified Firebase token.
   The client cannot choose which helper record is updated.
========================================================= */

router.post(
  "/submit",
  upload.fields([
    {
      name: "license",
      maxCount: 1,
    },
    {
      name: "insurance",
      maxCount: 1,
    },
    {
      name: "vehicle",
      maxCount: 1,
    },
  ]),
  async (req, res) => {
    try {
      const helper =
        await requireHelper(req);

      const files =
        req.files as {
          [fieldname: string]:
            Express.Multer.File[];
        };

      const license =
        files?.license?.[0];

      const insurance =
        files?.insurance?.[0];

      const vehicle =
        files?.vehicle?.[0];

      if (
        !license ||
        !insurance ||
        !vehicle
      ) {
        res.status(400).json({
          ok: false,
          error:
            "Driver license, insurance, and vehicle photos are required.",
        });

        return;
      }

      const [
        licenseUrl,
        insuranceUrl,
        vehicleUrl,
      ] =
        await Promise.all([
          uploadImage(
            license.buffer,
            helper.uid,
            "license"
          ),

          uploadImage(
            insurance.buffer,
            helper.uid,
            "insurance"
          ),

          uploadImage(
            vehicle.buffer,
            helper.uid,
            "vehicle"
          ),
        ]);

      const now =
        new Date()
          .toISOString();

      const db =
        getFirestore();

      const verificationRef =
        db
          .collection(
            "helperVerifications"
          )
          .doc(helper.uid);

      const userRef =
        db
          .collection("users")
          .doc(helper.uid);

      const batch =
        db.batch();

      batch.set(
        verificationRef,
        {
          helper_id:
            helper.uid,

          license_url:
            licenseUrl,

          insurance_url:
            insuranceUrl,

          vehicle_url:
            vehicleUrl,

          verification_status:
            "pending",

          submitted_at:
            now,

          updated_at:
            now,

          reviewed_at:
            null,

          reviewed_by:
            null,
        },
        {
          merge: true,
        }
      );

      batch.set(
        userRef,
        {
          verification_status:
            "pending",

          updatedAt:
            now,
        },
        {
          merge: true,
        }
      );

      await batch.commit();

      console.log(
        "[verification] submission received",
        {
          helperId:
            helper.uid,
        }
      );

      res.json({
        ok: true,
        helperId:
          helper.uid,

        status:
          "pending",
      });
    } catch (error: any) {
      if (
        sendAuthError(
          res,
          error
        )
      ) {
        return;
      }

      console.error(
        "[verification] submission error",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "Could not submit verification.",
      });
    }
  }
);

/* =========================================================
   ADMIN: GET VERIFICATION SUBMISSIONS
========================================================= */

router.get(
  "/",
  async (req, res) => {
    try {
      await requireAdmin(req);

      const db =
        getFirestore();

      const snapshot =
        await db
          .collection(
            "helperVerifications"
          )
          .get();

      const items =
        snapshot.docs
          .map((document) => {
            const data =
              document.data();

            return {
              id:
                document.id,

              helper_id:
                document.id,

              verification_status:
                String(
                  data.verification_status ||
                    "pending"
                ),

              license_url:
                data.license_url ||
                null,

              insurance_url:
                data.insurance_url ||
                null,

              vehicle_url:
                data.vehicle_url ||
                null,

              submitted_at:
                data.submitted_at ||
                null,

              updated_at:
                data.updated_at ||
                null,
            };
          })
          .sort(
            (
              a,
              b
            ) => {
              const aDate =
                String(
                  a.updated_at ||
                    a.submitted_at ||
                    ""
                );

              const bDate =
                String(
                  b.updated_at ||
                    b.submitted_at ||
                    ""
                );

              return bDate
                .localeCompare(
                  aDate
                );
            }
          );

      res.json({
        ok: true,
        items,
      });
    } catch (error: any) {
      if (
        sendAuthError(
          res,
          error
        )
      ) {
        return;
      }

      console.error(
        "[verification] load error",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Could not load helper verifications.",
      });
    }
  }
);

/* =========================================================
   ADMIN: APPROVE / REJECT HELPER
========================================================= */

router.post(
  "/:helperId/status",
  async (req, res) => {
    try {
      const admin =
        await requireAdmin(req);

      const helperId =
        String(
          req.params.helperId || ""
        ).trim();

      const status =
        String(
          req.body?.status || ""
        )
          .trim()
          .toLowerCase() as
          VerificationStatus;

      if (!helperId) {
        res.status(400).json({
          ok: false,
          error:
            "Helper ID is required.",
        });

        return;
      }

      if (
        status !== "approved" &&
        status !== "rejected"
      ) {
        res.status(400).json({
          ok: false,
          error:
            "Status must be approved or rejected.",
        });

        return;
      }

      const db =
        getFirestore();

      const verificationRef =
        db
          .collection(
            "helperVerifications"
          )
          .doc(helperId);

      const userRef =
        db
          .collection("users")
          .doc(helperId);

      const [
        verificationSnapshot,
        userSnapshot,
      ] =
        await Promise.all([
          verificationRef.get(),
          userRef.get(),
        ]);

      if (
        !verificationSnapshot.exists
      ) {
        res.status(404).json({
          ok: false,
          error:
            "Verification submission not found.",
        });

        return;
      }

      if (
        !userSnapshot.exists
      ) {
        res.status(404).json({
          ok: false,
          error:
            "Helper user record not found.",
        });

        return;
      }

      const role =
        String(
          userSnapshot.data()
            ?.role || ""
        )
          .trim()
          .toLowerCase();

      if (
        role !== "helper"
      ) {
        res.status(400).json({
          ok: false,
          error:
            "User is not a helper.",
        });

        return;
      }

      const now =
        new Date()
          .toISOString();

      const batch =
        db.batch();

      batch.set(
        verificationRef,
        {
          verification_status:
            status,

          updated_at:
            now,

          reviewed_at:
            now,

          reviewed_by:
            admin.uid,
        },
        {
          merge: true,
        }
      );

      batch.set(
        userRef,
        {
          verification_status:
            status,

          updatedAt:
            now,
        },
        {
          merge: true,
        }
      );

      await batch.commit();

      console.log(
        "[verification] helper status updated",
        {
          helperId,
          status,
          adminUid:
            admin.uid,
        }
      );

      res.json({
        ok: true,
        helperId,
        status,
      });
    } catch (error: any) {
      if (
        sendAuthError(
          res,
          error
        )
      ) {
        return;
      }

      console.error(
        "[verification] status error",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Could not update helper verification.",
      });
    }
  }
);

export default router;