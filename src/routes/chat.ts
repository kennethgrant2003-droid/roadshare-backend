import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import type { Server } from "socket.io";
import { getFirebaseAuth, getFirestore } from "../firebaseAdmin";

const activeStatuses = new Set(["accepted", "assigned", "enroute", "en_route", "arrived", "in_progress"]);

async function authorizedJob(req: Request) {
  const token = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw { status: 401, message: "Sign in to use job chat." };
  const decoded = await getFirebaseAuth().verifyIdToken(token).catch(() => {
    throw { status: 401, message: "Sign in to use job chat." };
  });
  const user = await getFirestore().collection("users").doc(decoded.uid).get();
  const role = String(user.data()?.role || "").toLowerCase();
  const jobId = String(req.params.jobId || "");
  if (!/^[\w-]{1,128}$/.test(jobId)) throw { status: 400, message: "Invalid job ID." };
  const snapshot = await getFirestore().collection("roadshareJobs").doc(jobId).get();
  if (!snapshot.exists) throw { status: 404, message: "Job not found." };
  const job = snapshot.data() || {};
  if ((role !== "customer" || job.customerId !== decoded.uid) &&
      (role !== "helper" || (job.helperId !== decoded.uid && job.helperProfile?.helperId !== decoded.uid))) {
    throw { status: 403, message: "This chat does not belong to your account." };
  }
  return { jobId, job, role };
}

function reportError(res: Response, error: unknown) {
  const known = error as { status?: number; message?: string };
  const status = known?.status || 500;
  if (status >= 500) console.error("[RoadShare] chat error:", error);
  return res.status(status).json({ ok: false, error: status === 401 ? "Sign in to use job chat." : status >= 500 ? "Chat is unavailable. Please retry." : known?.message });
}

export default function chatRoutes(io: Server) {
  const router = Router();

  router.get("/:jobId/messages", async (req, res) => {
    try {
      const { jobId } = await authorizedJob(req);
      const snapshot = await getFirestore().collection("roadshareJobs").doc(jobId)
        .collection("messages").orderBy("createdAt", "desc").limit(100).get();
      res.json({ ok: true, messages: snapshot.docs.reverse().map((doc) => ({ id: doc.id, ...doc.data() })) });
    } catch (error) { reportError(res, error); }
  });

  router.post("/:jobId/messages", async (req, res) => {
    try {
      const { jobId, job, role } = await authorizedJob(req);
      if (!activeStatuses.has(String(job.status || "").toLowerCase())) {
        return res.status(409).json({ ok: false, error: "Chat is available while the helper is assigned." });
      }
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text || text.length > 500) {
        return res.status(400).json({ ok: false, error: "Message must be 1 to 500 characters." });
      }
      const id = randomUUID();
      const message = { id, jobId, sender: role, text, createdAt: new Date().toISOString() };
      await getFirestore().collection("roadshareJobs").doc(jobId).collection("messages").doc(id).create(message);
      io.to(`job:${jobId}`).emit("chat:message", message);
      res.status(201).json({ ok: true, message });
    } catch (error) { reportError(res, error); }
  });

  return router;
}
