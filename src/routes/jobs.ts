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

router.get("/customer/history", async (req: Request, res: Response) => {
  try {
    const customer = await getAuthenticatedCustomer(req);
    const snapshot = await getFirestore().collection("roadshareJobs")
      .where("customerId", "==", customer.uid).get();
    const jobs = snapshot.docs.map((doc): Record<string, any> => ({ ...doc.data(), jobId: doc.id }))
      .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
      .slice(0, 100);
    return res.json({ ok: true, jobs });
  } catch (error: any) {
    return res.status(Number(error?.statusCode || 401)).json({ ok: false, error: "Could not load customer history." });
  }
});

router.get("/helper/earnings", async (req: Request, res: Response) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || token === req.headers.authorization) return res.status(401).json({ ok: false, error: "Helper login required." });
    const decoded = await getFirebaseAuth().verifyIdToken(token);
    const db = getFirestore();
    const user = await db.collection("users").doc(decoded.uid).get();
    if (user.data()?.role !== "helper") return res.status(403).json({ ok: false, error: "Helper account required." });
    const snapshot = await db.collection("roadshareJobs").where("payoutHelperId", "==", decoded.uid).get();
    const earnings = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((job: Record<string, any>) => job.payoutStatus === "paid" &&
        Number.isSafeInteger(job.helperPayoutCents) && job.helperPayoutCents > 0)
      .map((job: Record<string, any>) => ({
        id: job.id,
        serviceType: String(job.serviceType || "Roadside Assistance"),
        payoutCents: job.helperPayoutCents as number,
        completedAt: String(job.completedAt || job.updatedAt || job.createdAt || ""),
      }))
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
    return res.json({ ok: true, earnings });
  } catch (error) {
    console.error("[RoadShare] helper earnings failed:", error);
    return res.status(500).json({ ok: false, error: "Could not load helper earnings. Please retry." });
  }
});

router.get("/helper/active", async (req: Request, res: Response) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || token === req.headers.authorization) return res.status(401).json({ ok: false, error: "Helper login required." });
    const decoded = await getFirebaseAuth().verifyIdToken(token);
    const db = getFirestore();
    const user = await db.collection("users").doc(decoded.uid).get();
    if (user.data()?.role !== "helper") return res.status(403).json({ ok: false, error: "Helper account required." });
    const snapshot = await db.collection("roadshareJobs").where("helperId", "==", decoded.uid).get();
    const active = snapshot.docs.map((doc): Record<string, any> => ({ ...doc.data(), jobId: doc.id }))
      .filter((job) => ["accepted", "assigned", "enroute", "en_route", "arrived", "in_progress"].includes(String(job.status)))
      .sort((a, b) => Date.parse(String(b.updatedAt || b.createdAt || "")) - Date.parse(String(a.updatedAt || a.createdAt || "")));
    return res.json({ ok: true, activeJob: active[0] || null });
  } catch (error) {
    console.error("[RoadShare] helper recovery failed:", error);
    return res.status(401).json({ ok: false, error: "Could not verify helper session." });
  }
});

export default router;
