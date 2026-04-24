import { Router } from "express";
import prisma from "../config/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();

router.post("/go-online", requireAuth, requireRole("helper"), async (req: AuthedRequest, res) => {
  const { latitude, longitude, maxRadiusMiles } = req.body as {
    latitude?: number;
    longitude?: number;
    maxRadiusMiles?: number;
  };

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "latitude and longitude are required numbers" });
  }

  const helper = await prisma.helper.update({
    where: { userId: req.user!.userId },
    data: {
      isOnline: true,
      latitude,
      longitude,
      ...(typeof maxRadiusMiles === "number" ? { maxRadiusMiles } : {})
    }
  });

  return res.json({ ok: true, helper });
});

router.post("/go-offline", requireAuth, requireRole("helper"), async (req: AuthedRequest, res) => {
  const helper = await prisma.helper.update({
    where: { userId: req.user!.userId },
    data: { isOnline: false }
  });

  return res.json({ ok: true, helper });
});

router.post("/location", requireAuth, requireRole("helper"), async (req: AuthedRequest, res) => {
  const { latitude, longitude } = req.body as { latitude?: number; longitude?: number };

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "latitude and longitude are required numbers" });
  }

  const helper = await prisma.helper.update({
    where: { userId: req.user!.userId },
    data: { latitude, longitude }
  });

  return res.json({ ok: true, helper });
});

router.get("/me", requireAuth, requireRole("helper"), async (req: AuthedRequest, res) => {
  const helper = await prisma.helper.findUnique({ where: { userId: req.user!.userId } });
  return res.json({ ok: true, helper });
});

export default router;