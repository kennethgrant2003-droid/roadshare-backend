import {
  Router,
  Request,
  Response,
} from "express";

import {
  getFirebaseAuth,
  getFirestore,
} from "../firebaseAdmin";

const router = Router();

type AuthenticatedCustomer = {
  uid: string;
  email: string;
};

async function getAuthenticatedCustomer(
  req: Request
): Promise<AuthenticatedCustomer> {
  const authorization =
    String(
      req.headers.authorization ||
      ""
    ).trim();

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    const error: any =
      new Error(
        "Customer authentication is required."
      );

    error.statusCode = 401;

    throw error;
  }

  const token =
    authorization
      .slice(
        "Bearer ".length
      )
      .trim();

  if (!token) {
    const error: any =
      new Error(
        "Customer authentication is required."
      );

    error.statusCode = 401;

    throw error;
  }

  const decoded =
    await getFirebaseAuth()
      .verifyIdToken(token);

  const uid =
    String(
      decoded.uid ||
      ""
    ).trim();

  if (!uid) {
    const error: any =
      new Error(
        "Customer authentication could not be verified."
      );

    error.statusCode = 401;

    throw error;
  }

  const db =
    getFirestore();

  const userSnapshot =
    await db
      .collection("users")
      .doc(uid)
      .get();

  const role =
    String(
      userSnapshot.data()?.role ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    role !== "customer"
  ) {
    const error: any =
      new Error(
        "This RoadShare account is not a customer account."
      );

    error.statusCode = 403;

    throw error;
  }

  return {
    uid,

    email:
      String(
        decoded.email ||
        ""
      ),
  };
}

router.get(
  "/customer/active",
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const customer =
        await getAuthenticatedCustomer(
          req
        );

      const snapshot =
        await getFirestore()
          .collection(
            "roadshareJobs"
          )
          .where(
            "customerId",
            "==",
            customer.uid
          )
          .get();

      const activeStatuses =
        new Set([
          "searching",
          "accepted",
          "assigned",
          "enroute",
          "en_route",
          "arrived",
          "in_progress",
        ]);

      const jobs =
        snapshot.docs
          .map((document) => {
            const data =
              document.data();

            return {
              ...data,

              id:
                String(
                  data.id ||
                  document.id
                ),

              jobId:
                String(
                  data.jobId ||
                  data.id ||
                  document.id
                ),
            };
          })
          .filter((job: any) => {
            const status =
              String(
                job.status ||
                ""
              )
                .trim()
                .toLowerCase();

            return activeStatuses.has(
              status
            );
          })
          .sort(
            (
              left: any,
              right: any
            ) => {
              const leftTime =
                Date.parse(
                  String(
                    left.updatedAt ||
                    left.createdAt ||
                    ""
                  )
                ) || 0;

              const rightTime =
                Date.parse(
                  String(
                    right.updatedAt ||
                    right.createdAt ||
                    ""
                  )
                ) || 0;

              return (
                rightTime -
                leftTime
              );
            }
          );

      return res.json({
        ok: true,

        activeJob:
          jobs.length > 0
            ? jobs[0]
            : null,
      });
    } catch (
      error: any
    ) {
      console.error(
        "[RoadShare] active customer job recovery failed:",
        error
      );

      return res
        .status(
          Number(
            error?.statusCode ||
            500
          )
        )
        .json({
          ok: false,

          error:
            error?.message ||
            "RoadShare could not restore the active job.",
        });
    }
  }
);

export default router;