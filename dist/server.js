"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const stripe_1 = __importDefault(require("stripe"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
const db_1 = require("./db");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeSecretKey ? new stripe_1.default(stripeSecretKey) : null;
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: "*" }));
app.use(express_1.default.json({
    verify: (req, _res, buf) => {
        if (req.originalUrl === "/stripe/webhook") {
            req.rawBody = buf;
        }
    },
}));
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
});
const socketUsers = new Map();
function log(...args) {
    console.log(new Date().toISOString(), ...args);
}
function haversineMiles(lat1, lon1, lat2, lon2) {
    const toRad = (n) => (n * Math.PI) / 180;
    const R = 3958.8;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function estimateEtaMinutes(distanceMiles) {
    const mph = 35;
    return Math.max(5, Math.round((distanceMiles / mph) * 60));
}
function estimateQuoteCents(serviceType, distanceMiles) {
    const baseMap = {
        "Battery Jump": 6500,
        "Jump Start": 6500,
        "Tire Repair": 7900,
        "Tire Change": 7900,
        "Flat Tire": 7900,
        "Fuel Delivery": 7500,
        Lockout: 6500,
        Tow: 12000,
    };
    const base = baseMap[serviceType] ?? 8000;
    const travel = Math.round(distanceMiles * 175);
    return base + travel;
}
async function initSchema() {
    await (0, db_1.query)(`
    CREATE TABLE IF NOT EXISTS helper_accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      vehicle_type TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS helper_ratings (
      id SERIAL PRIMARY KEY,
      job_id TEXT NOT NULL,
      helper_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      review TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS helpers (
      socket_id TEXT PRIMARY KEY,
      helper_id TEXT,
      name TEXT,
      phone TEXT,
      vehicle_type TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      heading DOUBLE PRECISION DEFAULT 0,
      online BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customers (
      socket_id TEXT PRIMARY KEY,
      name TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      customer_socket_id TEXT NOT NULL,
      helper_socket_id TEXT,
      helper_id TEXT,
      status TEXT NOT NULL,
      service_type TEXT NOT NULL,
      vehicle_type TEXT,
      note TEXT,
      customer_name TEXT,
      customer_latitude DOUBLE PRECISION,
      customer_longitude DOUBLE PRECISION,
      customer_address TEXT,
      helper_name TEXT,
      helper_phone TEXT,
      helper_vehicle_type TEXT,
      quote_cents INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      stripe_payment_intent_id TEXT,
      distance_miles DOUBLE PRECISION NOT NULL DEFAULT 0,
      eta_minutes INTEGER NOT NULL DEFAULT 15,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
async function getHelperAccount(helperId) {
    return await (0, db_1.one)(`SELECT * FROM helper_accounts WHERE id = $1`, [helperId]);
}
async function getHelperStats(helperId) {
    const stats = await (0, db_1.one)(`
      SELECT
        COUNT(*) as ratingCount,
        AVG(rating) as avgRating
      FROM helper_ratings
      WHERE helper_id = $1
    `, [helperId]);
    return {
        ratingCount: Number(stats?.ratingcount || 0),
        avgRating: stats?.avgrating ? Number(stats.avgrating) : null,
    };
}
async function buildHelperProfile(helperId) {
    if (!helperId)
        return null;
    const account = await getHelperAccount(helperId);
    if (!account)
        return null;
    const stats = await getHelperStats(helperId);
    return {
        helperId: account.id,
        name: account.name,
        phone: account.phone || "",
        vehicleType: account.vehicle_type || "",
        bio: account.bio || "",
        avgRating: stats.avgRating ? Number(stats.avgRating.toFixed(1)) : 0,
        ratingCount: stats.ratingCount || 0,
    };
}
async function getJob(jobId) {
    return await (0, db_1.one)(`SELECT * FROM jobs WHERE id = $1`, [jobId]);
}
async function buildJobPayload(job) {
    return {
        id: job.id,
        customerSocketId: job.customer_socket_id,
        helperSocketId: job.helper_socket_id,
        helperId: job.helper_id,
        status: job.status,
        serviceType: job.service_type,
        vehicleType: job.vehicle_type,
        note: job.note,
        customerName: job.customer_name,
        quoteCents: Number(job.quote_cents),
        paymentStatus: job.payment_status,
        paymentIntentId: job.stripe_payment_intent_id,
        distanceMiles: Number(job.distance_miles),
        etaMinutes: Number(job.eta_minutes),
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        location: {
            latitude: job.customer_latitude == null ? null : Number(job.customer_latitude),
            longitude: job.customer_longitude == null ? null : Number(job.customer_longitude),
            address: job.customer_address,
        },
        helperProfile: await buildHelperProfile(job.helper_id),
    };
}
async function getOpenJobs() {
    const rows = await (0, db_1.many)(`SELECT * FROM jobs WHERE status = 'searching' ORDER BY created_at DESC`);
    return await Promise.all(rows.map(buildJobPayload));
}
async function getNearbyHelpers(customerLat, customerLng, maxMiles = 50) {
    const rows = await (0, db_1.many)(`
      SELECT * FROM helpers
      WHERE online = true
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND helper_id IS NOT NULL
    `);
    return rows
        .map((row) => ({
        ...row,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        distanceMiles: haversineMiles(customerLat, customerLng, Number(row.latitude), Number(row.longitude)),
    }))
        .filter((row) => row.distanceMiles <= maxMiles)
        .sort((a, b) => a.distanceMiles - b.distanceMiles);
}
async function emitTrackingForJob(jobId) {
    const job = await getJob(jobId);
    if (!job || !job.helper_socket_id)
        return;
    const helper = await (0, db_1.one)(`SELECT * FROM helpers WHERE socket_id = $1`, [job.helper_socket_id]);
    if (!helper || helper.latitude == null || helper.longitude == null)
        return;
    io.to(job.customer_socket_id).emit("tracking:update", {
        jobId: job.id,
        helperSocketId: job.helper_socket_id,
        helperId: job.helper_id,
        helperLocation: {
            latitude: Number(helper.latitude),
            longitude: Number(helper.longitude),
            heading: Number(helper.heading ?? 0),
        },
        helperProfile: await buildHelperProfile(job.helper_id),
    });
}
async function markJobPaid(jobId) {
    await (0, db_1.query)(`
      UPDATE jobs
      SET payment_status = 'paid', updated_at = NOW()
      WHERE id = $1
    `, [jobId]);
    const updated = await getJob(jobId);
    if (updated) {
        const payload = await buildJobPayload(updated);
        io.to(updated.customer_socket_id).emit("job:payment_updated", payload);
        if (updated.helper_socket_id) {
            io.to(updated.helper_socket_id).emit("job:payment_updated", payload);
        }
    }
}
app.get("/health", (_req, res) => {
    res.json({ ok: true, db: "postgres" });
});
app.post("/helpers/register", async (req, res) => {
    try {
        const { email, password, name, phone, vehicleType } = req.body;
        if (!email || !password || !name) {
            return res.status(400).json({
                ok: false,
                error: "email, password, and name are required",
            });
        }
        const normalizedEmail = String(email).toLowerCase().trim();
        const existing = await (0, db_1.one)(`SELECT id FROM helper_accounts WHERE email = $1`, [normalizedEmail]);
        if (existing) {
            return res.status(400).json({
                ok: false,
                error: "Email already registered",
            });
        }
        const helperId = `helper_${(0, uuid_1.v4)()}`;
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        await (0, db_1.query)(`
        INSERT INTO helper_accounts (
          id, email, password_hash, name, phone, vehicle_type, bio, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, '', NOW(), NOW())
      `, [
            helperId,
            normalizedEmail,
            passwordHash,
            name,
            phone || "",
            vehicleType || "",
        ]);
        return res.json({
            ok: true,
            helper: {
                helperId,
                email: normalizedEmail,
                name,
                phone: phone || "",
                vehicleType: vehicleType || "",
                bio: "",
                avgRating: 0,
                ratingCount: 0,
            },
        });
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error.message || "Registration failed",
        });
    }
});
app.post("/helpers/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({
                ok: false,
                error: "email and password are required",
            });
        }
        const helper = await (0, db_1.one)(`SELECT * FROM helper_accounts WHERE email = $1`, [String(email).toLowerCase().trim()]);
        if (!helper) {
            return res.status(400).json({
                ok: false,
                error: "Invalid email or password",
            });
        }
        const matches = await bcryptjs_1.default.compare(password, helper.password_hash);
        if (!matches) {
            return res.status(400).json({
                ok: false,
                error: "Invalid email or password",
            });
        }
        const stats = await getHelperStats(helper.id);
        return res.json({
            ok: true,
            helper: {
                helperId: helper.id,
                email: helper.email,
                name: helper.name,
                phone: helper.phone || "",
                vehicleType: helper.vehicle_type || "",
                bio: helper.bio || "",
                avgRating: stats.avgRating ? Number(stats.avgRating.toFixed(1)) : 0,
                ratingCount: stats.ratingCount || 0,
            },
        });
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error.message || "Login failed",
        });
    }
});
app.get("/helpers/:helperId/profile", async (req, res) => {
    try {
        const { helperId } = req.params;
        const helper = await getHelperAccount(helperId);
        if (!helper) {
            return res.status(404).json({
                ok: false,
                error: "Helper not found",
            });
        }
        const stats = await getHelperStats(helperId);
        return res.json({
            ok: true,
            helper: {
                helperId: helper.id,
                email: helper.email,
                name: helper.name,
                phone: helper.phone || "",
                vehicleType: helper.vehicle_type || "",
                bio: helper.bio || "",
                avgRating: stats.avgRating ? Number(stats.avgRating.toFixed(1)) : 0,
                ratingCount: stats.ratingCount || 0,
            },
        });
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error.message || "Failed to load profile",
        });
    }
});
app.post("/helpers/:helperId/profile", async (req, res) => {
    try {
        const { helperId } = req.params;
        const { name, phone, vehicleType, bio } = req.body;
        await (0, db_1.query)(`
        UPDATE helper_accounts
        SET
          name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          vehicle_type = COALESCE($3, vehicle_type),
          bio = COALESCE($4, bio),
          updated_at = NOW()
        WHERE id = $5
      `, [
            name ?? null,
            phone ?? null,
            vehicleType ?? null,
            bio ?? null,
            helperId,
        ]);
        return res.json({ ok: true });
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error.message || "Failed to update profile",
        });
    }
});
app.post("/ratings/submit", async (req, res) => {
    try {
        const { jobId, helperId, rating, review } = req.body;
        if (!jobId || !helperId || !rating) {
            return res.status(400).json({
                ok: false,
                error: "jobId, helperId, and rating are required",
            });
        }
        const numericRating = Number(rating);
        if (numericRating < 1 || numericRating > 5) {
            return res.status(400).json({
                ok: false,
                error: "rating must be between 1 and 5",
            });
        }
        await (0, db_1.query)(`
        INSERT INTO helper_ratings (job_id, helper_id, rating, review, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [jobId, helperId, numericRating, review || ""]);
        const stats = await getHelperStats(helperId);
        return res.json({
            ok: true,
            helperId,
            avgRating: stats.avgRating ? Number(stats.avgRating.toFixed(1)) : 0,
            ratingCount: stats.ratingCount || 0,
        });
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error.message || "Failed to submit rating",
        });
    }
});
app.post("/payments/create-intent", async (req, res) => {
    try {
        const { jobId } = req.body;
        if (!jobId) {
            return res.status(400).json({ ok: false, error: "jobId is required" });
        }
        const job = await getJob(jobId);
        if (!job) {
            return res.status(404).json({ ok: false, error: "Job not found" });
        }
        if (!stripe) {
            await markJobPaid(jobId);
            const updated = await getJob(jobId);
            return res.json({
                ok: true,
                bypassed: true,
                stripeEnabled: false,
                quoteCents: updated?.quote_cents ?? job.quote_cents,
                paymentStatus: "paid",
            });
        }
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Number(job.quote_cents),
            currency: "usd",
            automatic_payment_methods: { enabled: true },
            metadata: {
                jobId: job.id,
                serviceType: job.service_type,
            },
        });
        await (0, db_1.query)(`
        UPDATE jobs
        SET payment_status = 'pending', stripe_payment_intent_id = $1, updated_at = NOW()
        WHERE id = $2
      `, [paymentIntent.id, jobId]);
        return res.json({
            ok: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            quoteCents: Number(job.quote_cents),
            paymentStatus: "pending",
        });
    }
    catch (error) {
        log("stripe create-intent error", error);
        return res.status(500).json({
            ok: false,
            error: error.message || "Failed to create payment intent",
        });
    }
});
app.post("/payments/confirm", async (req, res) => {
    try {
        const { jobId, paymentIntentId } = req.body;
        if (!jobId) {
            return res.status(400).json({ ok: false, error: "jobId is required" });
        }
        const job = await getJob(jobId);
        if (!job) {
            return res.status(404).json({ ok: false, error: "Job not found" });
        }
        if (!stripe) {
            await markJobPaid(jobId);
            const updated = await getJob(jobId);
            return res.json({
                ok: true,
                paymentStatus: "paid",
                job: updated ? await buildJobPayload(updated) : null,
            });
        }
        const intentId = paymentIntentId || job.stripe_payment_intent_id;
        if (!intentId) {
            return res.status(400).json({
                ok: false,
                error: "Missing payment intent id",
            });
        }
        const intent = await stripe.paymentIntents.retrieve(intentId);
        if (intent.status === "succeeded" || intent.status === "requires_capture") {
            await markJobPaid(jobId);
            const updated = await getJob(jobId);
            return res.json({
                ok: true,
                paymentStatus: "paid",
                stripeStatus: intent.status,
                job: updated ? await buildJobPayload(updated) : null,
            });
        }
        return res.status(400).json({
            ok: false,
            error: `Payment not completed. Stripe status: ${intent.status}`,
        });
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error.message || "Failed to confirm payment",
        });
    }
});
io.on("connection", (socket) => {
    log("socket connected", socket.id);
    socket.on("user:join", async (payload, ack) => {
        try {
            const role = payload?.role;
            if (role !== "customer" && role !== "helper") {
                ack?.({ ok: false, error: "Invalid role" });
                return;
            }
            const user = {
                role,
                helperId: payload?.helperId || "",
                name: payload?.name || "",
                phone: payload?.phone || "",
                vehicleType: payload?.vehicleType || "",
            };
            socketUsers.set(socket.id, user);
            socket.join(role);
            if (role === "helper") {
                if (!payload?.helperId) {
                    ack?.({ ok: false, error: "helperId is required for helper join" });
                    return;
                }
                const account = await getHelperAccount(payload.helperId);
                if (!account) {
                    ack?.({ ok: false, error: "Helper account not found" });
                    return;
                }
                await (0, db_1.query)(`
            INSERT INTO helpers (
              socket_id, helper_id, name, phone, vehicle_type, latitude, longitude, heading, online, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
            ON CONFLICT (socket_id) DO UPDATE SET
              helper_id = EXCLUDED.helper_id,
              name = EXCLUDED.name,
              phone = EXCLUDED.phone,
              vehicle_type = EXCLUDED.vehicle_type,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              heading = EXCLUDED.heading,
              online = true,
              updated_at = NOW()
          `, [
                    socket.id,
                    account.id,
                    account.name,
                    account.phone || "",
                    account.vehicle_type || "",
                    payload?.location?.latitude ?? null,
                    payload?.location?.longitude ?? null,
                    payload?.location?.heading ?? 0,
                ]);
                socket.emit("jobs:sync", await getOpenJobs());
            }
            else {
                await (0, db_1.query)(`
            INSERT INTO customers (socket_id, name, latitude, longitude, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (socket_id) DO UPDATE SET
              name = EXCLUDED.name,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              updated_at = NOW()
          `, [
                    socket.id,
                    user.name || "",
                    payload?.location?.latitude ?? null,
                    payload?.location?.longitude ?? null,
                ]);
            }
            ack?.({ ok: true, socketId: socket.id, role });
        }
        catch (error) {
            ack?.({ ok: false, error: error.message || "Join failed" });
        }
    });
    socket.on("location:update", async (payload) => {
        try {
            const user = socketUsers.get(socket.id);
            if (!user)
                return;
            const latitude = payload?.location?.latitude ?? payload?.latitude ?? null;
            const longitude = payload?.location?.longitude ?? payload?.longitude ?? null;
            const heading = payload?.location?.heading ?? payload?.heading ?? 0;
            if (latitude == null || longitude == null)
                return;
            if (user.role === "helper") {
                await (0, db_1.query)(`
            UPDATE helpers
            SET latitude = $1, longitude = $2, heading = $3, updated_at = NOW(), online = true
            WHERE socket_id = $4
          `, [latitude, longitude, heading, socket.id]);
                if (payload?.jobId) {
                    await emitTrackingForJob(payload.jobId);
                }
                else {
                    const activeJobs = await (0, db_1.many)(`
              SELECT id FROM jobs
              WHERE helper_socket_id = $1
                AND status IN ('accepted','en_route','arrived')
            `, [socket.id]);
                    for (const row of activeJobs) {
                        await emitTrackingForJob(row.id);
                    }
                }
            }
            else {
                await (0, db_1.query)(`
            UPDATE customers
            SET latitude = $1, longitude = $2, updated_at = NOW()
            WHERE socket_id = $3
          `, [latitude, longitude, socket.id]);
            }
        }
        catch (error) {
            log("location:update error", error);
        }
    });
    socket.on("job:create", async (payload, ack) => {
        try {
            const user = socketUsers.get(socket.id);
            if (!user || user.role !== "customer") {
                ack?.({ ok: false, error: "Only customers can create jobs" });
                return;
            }
            const location = payload?.location;
            if (location?.latitude == null || location?.longitude == null) {
                ack?.({ ok: false, error: "Customer location is required" });
                return;
            }
            const nearbyHelpers = await getNearbyHelpers(location.latitude, location.longitude, 50);
            const nearest = nearbyHelpers[0];
            const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            if (!nearest) {
                const quoteCents = estimateQuoteCents(payload?.serviceType || "Roadside Assistance", 0);
                await (0, db_1.query)(`
            INSERT INTO jobs (
              id, customer_socket_id, helper_socket_id, helper_id, status, service_type, vehicle_type, note,
              customer_name, customer_latitude, customer_longitude, customer_address,
              helper_name, helper_phone, helper_vehicle_type,
              quote_cents, payment_status, stripe_payment_intent_id, distance_miles, eta_minutes, created_at, updated_at
            )
            VALUES ($1, $2, NULL, NULL, 'searching', $3, $4, $5, $6, $7, $8, $9, NULL, NULL, NULL, $10, 'unpaid', NULL, $11, $12, NOW(), NOW())
          `, [
                    jobId,
                    socket.id,
                    payload?.serviceType || "Roadside Assistance",
                    payload?.vehicleType || "",
                    payload?.note || "",
                    payload?.customerName || user.name || "Customer",
                    location.latitude,
                    location.longitude,
                    location.address || "",
                    quoteCents,
                    0,
                    15,
                ]);
                const job = await getJob(jobId);
                const jobPayload = job ? await buildJobPayload(job) : null;
                io.to(socket.id).emit("job:created", jobPayload);
                ack?.({ ok: true, job: jobPayload, targetedHelpers: 0 });
                return;
            }
            const distanceMiles = Number(nearest.distanceMiles.toFixed(1));
            const etaMinutes = estimateEtaMinutes(distanceMiles);
            const quoteCents = estimateQuoteCents(payload?.serviceType || "Roadside Assistance", distanceMiles);
            const helperProfile = await buildHelperProfile(nearest.helper_id);
            await (0, db_1.query)(`
          INSERT INTO jobs (
            id, customer_socket_id, helper_socket_id, helper_id, status, service_type, vehicle_type, note,
            customer_name, customer_latitude, customer_longitude, customer_address,
            helper_name, helper_phone, helper_vehicle_type,
            quote_cents, payment_status, stripe_payment_intent_id, distance_miles, eta_minutes, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, 'accepted', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'unpaid', NULL, $16, $17, NOW(), NOW())
        `, [
                jobId,
                socket.id,
                nearest.socket_id,
                nearest.helper_id,
                payload?.serviceType || "Roadside Assistance",
                payload?.vehicleType || "",
                payload?.note || "",
                payload?.customerName || user.name || "Customer",
                location.latitude,
                location.longitude,
                location.address || "",
                helperProfile?.name || "Helper",
                helperProfile?.phone || "",
                helperProfile?.vehicleType || "",
                quoteCents,
                distanceMiles,
                etaMinutes,
            ]);
            const acceptedJob = await getJob(jobId);
            const jobPayload = acceptedJob ? await buildJobPayload(acceptedJob) : null;
            io.to(socket.id).emit("job:created", jobPayload);
            io.to(socket.id).emit("job:accepted", jobPayload);
            io.to(nearest.socket_id).emit("job:accepted", jobPayload);
            await emitTrackingForJob(jobId);
            ack?.({ ok: true, job: jobPayload, autoAssigned: true });
        }
        catch (error) {
            ack?.({ ok: false, error: error.message || "Failed to create job" });
        }
    });
    socket.on("job:update_status", async (payload, ack) => {
        try {
            const user = socketUsers.get(socket.id);
            if (!user || user.role !== "helper") {
                ack?.({ ok: false, error: "Only helpers can update status" });
                return;
            }
            const job = await getJob(payload.jobId);
            if (!job || job.helper_socket_id !== socket.id) {
                ack?.({ ok: false, error: "Active job not found for this helper" });
                return;
            }
            await (0, db_1.query)(`
            UPDATE jobs
            SET status = $1, updated_at = NOW()
            WHERE id = $2
          `, [payload.status, payload.jobId]);
            const updated = await getJob(payload.jobId);
            const jobPayload = updated ? await buildJobPayload(updated) : null;
            if (updated) {
                io.to(updated.customer_socket_id).emit("job:status_updated", jobPayload);
                io.to(socket.id).emit("job:status_updated", jobPayload);
            }
            ack?.({ ok: true, job: jobPayload });
        }
        catch (error) {
            ack?.({ ok: false, error: error.message || "Status update failed" });
        }
    });
    socket.on("disconnect", async () => {
        const user = socketUsers.get(socket.id);
        socketUsers.delete(socket.id);
        if (user?.role === "helper") {
            await (0, db_1.query)(`
          UPDATE helpers
          SET online = false, updated_at = NOW()
          WHERE socket_id = $1
        `, [socket.id]);
        }
        log("socket disconnected", socket.id);
    });
});
async function start() {
    await initSchema();
    server.listen(PORT, HOST, () => {
        log(`RoadShare Postgres backend listening on http://${HOST}:${PORT}`);
    });
}
start().catch(async (error) => {
    console.error("Server failed to start:", error);
    await db_1.pool.end();
    process.exit(1);
});
/* ================= STRIPE WEBHOOK ================= */
app.post("/stripe/webhook", async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.log("[stripe-webhook] missing secret");
        return res.status(500).send("Webhook secret missing");
    }
    const signature = req.headers["stripe-signature"];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    }
    catch (err) {
        console.log("[stripe-webhook] signature error", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    try {
        if (event.type === "payment_intent.succeeded") {
            const paymentIntent = event.data.object;
            const jobId = paymentIntent.metadata?.jobId;
            if (jobId) {
                await markJobPaid(jobId);
                console.log("? Job marked paid via webhook:", jobId);
            }
        }
        if (event.type === "payment_intent.payment_failed") {
            const paymentIntent = event.data.object;
            const jobId = paymentIntent.metadata?.jobId;
            if (jobId) {
                console.log("? Payment failed for job:", jobId);
            }
        }
        res.json({ received: true });
    }
    catch (err) {
        console.log("[stripe-webhook] handler error", err.message);
        res.status(500).send("Webhook handler error");
    }
});
/* ================================================== */
