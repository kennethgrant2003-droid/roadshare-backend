import type { Server, Socket } from "socket.io";
import { emitToAdmins, emitToJob } from "./io";

type HelperLocationUpdatePayload = {
  helperUserId: string;
  jobId: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  timestamp?: number | null;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default function registerSocketHandlers(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log(`[socket] connected ${socket.id}`);

    socket.on("customer:register", (payload: { customerId?: string } = {}) => {
      const customerId = safeString(payload.customerId);
      if (!customerId) return;

      socket.data.customerId = customerId;
      socket.join(`customer:${customerId}`);
      console.log(`[socket] customer registered ${customerId} -> ${socket.id}`);
    });

    socket.on("helper:register", (payload: { helperUserId?: string } = {}) => {
      const helperUserId = safeString(payload.helperUserId);
      if (!helperUserId) return;

      socket.data.helperUserId = helperUserId;
      socket.join(`helper:${helperUserId}`);
      console.log(`[socket] helper registered ${helperUserId} -> ${socket.id}`);

      io.to(`helper:${helperUserId}`).emit("helper:registered", {
        helperUserId,
        socketId: socket.id,
        ok: true,
      });
    });

    socket.on("admin:register", (payload: { adminId?: string } = {}) => {
      const adminId = safeString(payload.adminId) || "admin";
      socket.data.adminId = adminId;
      socket.join("admin:global");
      console.log(`[socket] admin registered ${adminId} -> ${socket.id}`);
    });

    socket.on("job:join", (payload: { jobId?: string } = {}) => {
      const jobId = safeString(payload.jobId);
      if (!jobId) return;

      socket.join(`job:${jobId}`);
      console.log(`[socket] joined room job:${jobId} -> ${socket.id}`);
    });

    socket.on("job:leave", (payload: { jobId?: string } = {}) => {
      const jobId = safeString(payload.jobId);
      if (!jobId) return;

      socket.leave(`job:${jobId}`);
      console.log(`[socket] left room job:${jobId} -> ${socket.id}`);
    });

    socket.on("helper:location:update", (rawPayload: HelperLocationUpdatePayload) => {
      const helperUserId = safeString(rawPayload?.helperUserId);
      const jobId = safeString(rawPayload?.jobId);
      const lat = safeNumber(rawPayload?.lat);
      const lng = safeNumber(rawPayload?.lng);

      if (!helperUserId || !jobId || lat === null || lng === null) {
        return;
      }

      const payload = {
        jobId,
        helperUserId,
        lat,
        lng,
        heading: safeNumber(rawPayload?.heading),
        speed: safeNumber(rawPayload?.speed),
        accuracy: safeNumber(rawPayload?.accuracy),
        timestamp:
          typeof rawPayload?.timestamp === "number" && Number.isFinite(rawPayload.timestamp)
            ? rawPayload.timestamp
            : Date.now(),
      };

      emitToJob(jobId, "helper:location", payload);

      emitToAdmins("admin:job:update", {
        jobId,
        status: "tracking",
        helperUserId,
        timestamp: payload.timestamp,
        message: "Helper GPS updated",
      });

      emitToAdmins("helper:location", payload);

      io.to(`helper:${helperUserId}`).emit("helper:location:ack", payload);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected ${socket.id} (${reason})`);
    });
  });
}
