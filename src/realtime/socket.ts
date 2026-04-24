import { Server as IOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "roadshare_dev_secret_change_me";

type JwtPayload = {
  userId: string;
  role: "customer" | "helper" | "admin";
};

export function setupSocket(io: IOServer) {
  io.use((socket, next) => {
    try {
      const authHeader =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization;

      if (!authHeader) return next(new Error("Missing auth token"));

      const token =
        typeof authHeader === "string" && authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : authHeader;

      const decoded = jwt.verify(token as string, JWT_SECRET) as JwtPayload;
      (socket.data as any).user = decoded;

      return next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket.data as any).user as JwtPayload;

    socket.join(`user:${user.userId}`);

    socket.emit("connected", {
      ok: true,
      userId: user.userId,
      role: user.role,
    });

    socket.on("ping", () => socket.emit("pong"));
  });
}