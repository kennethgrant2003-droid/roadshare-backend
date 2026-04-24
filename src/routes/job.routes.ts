import { Router } from "express";
import {
  emitToAdmins,
  emitToCustomer,
  emitToHelper,
  emitToJob,
} from "../realtime/io";

const router = Router();

type JobStatus =
  | "searching"
  | "accepted"
  | "assigned"
  | "arriving"
  | "on_scene"
  | "started"
  | "completed"
  | "cancelled";

type JobPhoto = {
  id: string;
  role: "customer" | "helper";
  uploadedAt: number;
  mimeType: string;
  fileName: string;
  base64: string;
};

type JobRecord = {
  id: string;
  customerId: string;
  serviceType: string;
  pickupLat: number;
  pickupLng: number;
  note?: string;
  status: JobStatus;
  helperUserId?: string | null;
  helper?: {
    userId: string;
    name: string;
    phone?: string;
    vehicle?: string;
    rating?: number;
  } | null;
  etaMinutes?: number | null;
  photos: JobPhoto[];
  createdAt: number;
  updatedAt: number;
};

const jobs = new Map<string, JobRecord>();

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

function toNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function now() {
  return Date.now();
}

function buildJobUpdatePayload(job: JobRecord, message?: string) {
  return {
    jobId: job.id,
    status: job.status,
    customerId: job.customerId,
    serviceType: job.serviceType,
    pickupLat: job.pickupLat,
    pickupLng: job.pickupLng,
    etaMinutes: job.etaMinutes ?? null,
    helper: job.helper ?? null,
    photoCount: job.photos.length,
    message: message || null,
    timestamp: job.updatedAt,
  };
}

function buildPhotoSummary(photo: JobPhoto) {
  return {
    id: photo.id,
    role: photo.role,
    uploadedAt: photo.uploadedAt,
    mimeType: photo.mimeType,
    fileName: photo.fileName,
    dataUrl: `data:${photo.mimeType};base64,${photo.base64}`,
  };
}

function broadcastJobCreated(job: JobRecord, message?: string) {
  const payload = buildJobUpdatePayload(job, message);

  emitToCustomer(job.customerId, "job:update", payload);
  emitToCustomer(job.customerId, "job:status", payload);

  emitToAdmins("admin:job:created", {
    jobId: job.id,
    status: job.status,
    customerId: job.customerId,
    helperUserId: job.helperUserId ?? null,
    serviceType: job.serviceType,
    pickupLat: job.pickupLat,
    pickupLng: job.pickupLng,
    etaMinutes: job.etaMinutes ?? null,
    photoCount: job.photos.length,
    message: message || "Job created",
    timestamp: job.updatedAt,
  });
}

function broadcastJobUpdate(job: JobRecord, message?: string) {
  const payload = buildJobUpdatePayload(job, message);

  emitToJob(job.id, "job:update", payload);
  emitToJob(job.id, "job:status", payload);

  emitToCustomer(job.customerId, "job:update", payload);
  emitToCustomer(job.customerId, "job:status", payload);

  emitToAdmins("admin:job:update", {
    jobId: job.id,
    status: job.status,
    customerId: job.customerId,
    helperUserId: job.helperUserId ?? null,
    serviceType: job.serviceType,
    pickupLat: job.pickupLat,
    pickupLng: job.pickupLng,
    etaMinutes: job.etaMinutes ?? null,
    photoCount: job.photos.length,
    message: message || null,
    timestamp: job.updatedAt,
  });
}

function assignDemoHelper(job: JobRecord, helperUserId: string) {
  if (job.status !== "searching") {
    return;
  }

  job.helperUserId = helperUserId;
  job.status = "assigned";
  job.etaMinutes = 12;
  job.helper = {
    userId: helperUserId,
    name: "RoadShare Helper",
    phone: "(555) 010-2222",
    vehicle: "Tow Truck",
    rating: 4.9,
  };
  job.updatedAt = now();

  jobs.set(job.id, job);

  broadcastJobUpdate(job, "Helper assigned and heading your way.");
}

router.post("/", (req, res) => {
  const customerId =
    typeof req.body?.customerId === "string" && req.body.customerId.trim()
      ? req.body.customerId.trim()
      : "demo-customer";

  const serviceType =
    typeof req.body?.serviceType === "string" && req.body.serviceType.trim()
      ? req.body.serviceType.trim()
      : "roadside";

  const pickupLat = toNumber(req.body?.pickupLat, 33.7488);
  const pickupLng = toNumber(req.body?.pickupLng, -84.3877);
  const note =
    typeof req.body?.note === "string" ? req.body.note.trim() : "";

  const job: JobRecord = {
    id: makeId("job"),
    customerId,
    serviceType,
    pickupLat,
    pickupLng,
    note,
    status: "searching",
    helperUserId: null,
    helper: null,
    etaMinutes: null,
    photos: [],
    createdAt: now(),
    updatedAt: now(),
  };

  jobs.set(job.id, job);

  broadcastJobCreated(job, "Dispatch is notifying nearby helpers.");
  broadcastJobUpdate(job, "Searching for an available helper.");

  const demoDispatchHelperUserId =
    process.env.DEMO_DISPATCH_HELPER_USER_ID ||
    process.env.DEFAULT_HELPER_USER_ID ||
    "helper-demo-1";

  emitToHelper(demoDispatchHelperUserId, "job:incoming", {
    id: job.id,
    customerId: job.customerId,
    serviceType: job.serviceType,
    pickupLat: job.pickupLat,
    pickupLng: job.pickupLng,
    note: job.note,
    status: job.status,
  });

  const enableAutoAssign =
    String(process.env.ENABLE_DEMO_AUTO_ASSIGN || "true").toLowerCase() === "true";

  if (enableAutoAssign) {
    setTimeout(() => {
      const currentJob = jobs.get(job.id);
      if (!currentJob) return;
      assignDemoHelper(currentJob, demoDispatchHelperUserId);
    }, 3000);
  }

  return res.status(201).json({
    ok: true,
    job,
  });
});

router.get("/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      message: "Job not found.",
    });
  }

  return res.json({
    ok: true,
    job,
  });
});

router.get("/:jobId/photos", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      message: "Job not found.",
    });
  }

  return res.json({
    ok: true,
    photos: job.photos.map(buildPhotoSummary),
  });
});

router.post("/:jobId/photos", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      message: "Job not found.",
    });
  }

  const role =
    req.body?.role === "helper" || req.body?.role === "customer"
      ? req.body.role
      : null;

  if (!role) {
    return res.status(400).json({
      ok: false,
      message: "role must be customer or helper.",
    });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (items.length === 0) {
    return res.status(400).json({
      ok: false,
      message: "At least one photo is required.",
    });
  }

  const currentRoleCount = job.photos.filter((photo) => photo.role === role).length;

  if (currentRoleCount + items.length > 2) {
    return res.status(400).json({
      ok: false,
      message: `${role} can upload a maximum of 2 photos per job.`,
    });
  }

  const newPhotos: JobPhoto[] = [];

  for (const item of items) {
    const base64 =
      typeof item?.base64 === "string" && item.base64.trim()
        ? item.base64.trim()
        : "";

    const mimeType =
      typeof item?.mimeType === "string" && item.mimeType.trim()
        ? item.mimeType.trim()
        : "image/jpeg";

    const fileName =
      typeof item?.fileName === "string" && item.fileName.trim()
        ? item.fileName.trim()
        : `${role}-${makeId("photo")}.jpg`;

    if (!base64) {
      return res.status(400).json({
        ok: false,
        message: "Every photo must include base64 content.",
      });
    }

    newPhotos.push({
      id: makeId("photo"),
      role,
      uploadedAt: now(),
      mimeType,
      fileName,
      base64,
    });
  }

  job.photos.push(...newPhotos);
  job.updatedAt = now();
  jobs.set(job.id, job);

  broadcastJobUpdate(job, `${role} uploaded photo${newPhotos.length > 1 ? "s" : ""}.`);

  emitToJob(job.id, "job:photos", {
    jobId: job.id,
    role,
    photoCount: job.photos.length,
    photos: job.photos.map(buildPhotoSummary),
    timestamp: job.updatedAt,
  });

  return res.json({
    ok: true,
    uploaded: newPhotos.map(buildPhotoSummary),
    photoCount: job.photos.length,
  });
});

router.post("/:jobId/accept", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      message: "Job not found.",
    });
  }

  const helperUserId =
    typeof req.body?.helperUserId === "string" && req.body.helperUserId.trim()
      ? req.body.helperUserId.trim()
      : "";

  if (!helperUserId) {
    return res.status(400).json({
      ok: false,
      message: "helperUserId is required.",
    });
  }

  job.helperUserId = helperUserId;
  job.status = "assigned";
  job.etaMinutes = 15;
  job.helper = {
    userId: helperUserId,
    name: "RoadShare Helper",
    phone: "(555) 010-2222",
    vehicle: "Tow Truck",
    rating: 4.9,
  };
  job.updatedAt = now();

  jobs.set(job.id, job);

  broadcastJobUpdate(job, "Helper assigned and heading your way.");

  return res.json({
    ok: true,
    job,
  });
});

router.post("/:jobId/status", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      message: "Job not found.",
    });
  }

  const nextStatus =
    typeof req.body?.status === "string" ? req.body.status.trim() : "";

  const allowed: JobStatus[] = [
    "searching",
    "accepted",
    "assigned",
    "arriving",
    "on_scene",
    "started",
    "completed",
    "cancelled",
  ];

  if (!allowed.includes(nextStatus as JobStatus)) {
    return res.status(400).json({
      ok: false,
      message: "Invalid status.",
    });
  }

  job.status = nextStatus as JobStatus;
  job.updatedAt = now();

  if (typeof req.body?.etaMinutes === "number" && Number.isFinite(req.body.etaMinutes)) {
    job.etaMinutes = req.body.etaMinutes;
  }

  jobs.set(job.id, job);

  if (typeof req.body?.message === "string" && req.body.message.trim()) {
    broadcastJobUpdate(job, req.body.message.trim());
  } else {
    broadcastJobUpdate(job, `Job moved to ${job.status}.`);
  }

  return res.json({
    ok: true,
    job,
  });
});

export default router;
