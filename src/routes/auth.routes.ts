import { Router } from "express";
import prisma from "../config/prisma";
import { sendOtp, verifyOtp } from "../services/otp.service";
import { signToken } from "../services/jwt.service";

const router = Router();

router.post("/send-code", (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: "phone is required" });

  const result = sendOtp(phone);

  return res.json({
    ok: true,
    phone: result.phone,
    devCode: result.code
  });
});

router.post("/verify", async (req, res) => {
  const { phone, code, role } = req.body as { phone?: string; code?: string; role?: string };
  if (!phone || !code) return res.status(400).json({ error: "phone and code are required" });

  const v = verifyOtp(phone, code);
  if (!v.ok) return res.status(401).json({ ok: false, reason: v.reason });

  const userRole = role === "helper" ? "helper" : "customer";

  const user = await prisma.user.upsert({
    where: { phone: v.phone },
    update: { role: userRole as any },
    create: { phone: v.phone, role: userRole as any }
  });

  if (userRole === "helper") {
    await prisma.helper.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id }
    });
  }

  const token = signToken({ userId: user.id, role: user.role });

  return res.json({
    ok: true,
    token,
    user: { id: user.id, role: user.role, phone: user.phone }
  });
});

export default router;