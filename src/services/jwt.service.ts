import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "roadshare_dev_secret_change_me";

export function signToken(payload: { userId: string; role: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}