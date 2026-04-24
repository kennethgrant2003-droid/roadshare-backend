import type { Server } from "socket.io";

let io: Server | null = null;

export function setIO(server: Server) {
  io = server;
}

export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.IO has not been initialized yet.");
  }
  return io;
}

export function emitToJob(jobId: string, event: string, payload: unknown) {
  getIO().to(`job:${jobId}`).emit(event, payload);
}

export function emitToHelper(helperUserId: string, event: string, payload: unknown) {
  getIO().to(`helper:${helperUserId}`).emit(event, payload);
}

export function emitToCustomer(customerId: string, event: string, payload: unknown) {
  getIO().to(`customer:${customerId}`).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown) {
  getIO().to("admin:global").emit(event, payload);
}
