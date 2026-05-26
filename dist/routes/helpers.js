"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const cloudinary_1 = require("cloudinary");
const stripe_1 = __importDefault(require("stripe"));
const db_1 = require("../db");
const router = express_1.default.Router();
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
async function ensureHelperColumns() {
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS name TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS email TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS phone TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS password TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS vehicle_type TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS socket_id TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS profile_photo_url TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`);
    await (0, db_1.query)(`ALTER TABLE helpers ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE`);
}
async function createHelper(req, res) {
    try {
        await ensureHelperColumns();
        const { name, email, phone, password, vehicleType } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Name, email, and password are required" });
        }
        const existing = await (0, db_1.query)(`SELECT * FROM helpers WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
        if (existing.rowCount && existing.rowCount > 0) {
            return res.json({
                ok: true,
                helper: existing.rows[0],
                helperId: existing.rows[0].id,
                stripeAccountId: existing.rows[0].stripe_account_id,
                message: "Helper already exists",
            });
        }
        const socketId = `pending_${Date.now()}`;
        const helperResult = await (0, db_1.query)(`
      INSERT INTO helpers
        (name, email, phone, password, vehicle_type, socket_id)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `, [name, email, phone || "", password, vehicleType || "", socketId]);
        const helper = helperResult.rows[0];
        const account = await stripe.accounts.create({
            type: "express",
            email,
            metadata: {
                helperId: String(helper.id),
                helperName: name,
                app: "RoadShare",
            },
            capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
            },
        });
        const updated = await (0, db_1.query)(`
      UPDATE helpers
      SET stripe_account_id = $1
      WHERE id = $2
      RETURNING *
      `, [account.id, helper.id]);
        res.json({
            ok: true,
            helper: updated.rows[0],
            helperId: helper.id,
            stripeAccountId: account.id,
        });
    }
    catch (err) {
        console.error("Create helper failed:", err);
        res.status(500).json({ error: err.message || "Create helper failed" });
    }
}
router.post("/create", createHelper);
router.post("/signup", createHelper);
router.post("/register", createHelper);
router.post("/", createHelper);
router.post("/login", async (req, res) => {
    try {
        await ensureHelperColumns();
        const { email, password } = req.body;
        const result = await (0, db_1.query)(`
      SELECT *
      FROM helpers
      WHERE LOWER(email) = LOWER($1)
      AND password = $2
      LIMIT 1
      `, [email, password]);
        if (result.rowCount === 0) {
            return res.status(401).json({ error: "Invalid email or password" });
        }
        res.json({
            ok: true,
            helper: result.rows[0],
            helperId: result.rows[0].id,
            stripeAccountId: result.rows[0].stripe_account_id,
        });
    }
    catch (err) {
        console.error("Helper login failed:", err);
        res.status(500).json({ error: err.message || "Helper login failed" });
    }
});
router.get("/", async (_req, res) => {
    try {
        await ensureHelperColumns();
        const result = await (0, db_1.query)(`
      SELECT *
      FROM helpers
      ORDER BY id DESC
    `);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post("/:helperId/stripe/onboard", async (req, res) => {
    try {
        await ensureHelperColumns();
        const { helperId } = req.params;
        const { email } = req.body;
        const helperResult = await (0, db_1.query)(`SELECT * FROM helpers WHERE id = $1`, [helperId]);
        if (helperResult.rowCount === 0) {
            return res.status(404).json({ error: "Helper not found" });
        }
        const helper = helperResult.rows[0];
        let stripeAccountId = helper.stripe_account_id;
        if (!stripeAccountId) {
            const account = await stripe.accounts.create({
                type: "express",
                email: email || helper.email,
                metadata: {
                    helperId: String(helperId),
                    helperName: helper.name || "",
                    app: "RoadShare",
                },
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true },
                },
            });
            stripeAccountId = account.id;
            await (0, db_1.query)(`UPDATE helpers SET stripe_account_id = $1 WHERE id = $2`, [stripeAccountId, helperId]);
        }
        const accountLink = await stripe.accountLinks.create({
            account: stripeAccountId,
            refresh_url: "https://roadshare-backend.onrender.com/health",
            return_url: "https://roadshare-backend.onrender.com/health",
            type: "account_onboarding",
        });
        res.json({
            ok: true,
            stripeAccountId,
            onboardingUrl: accountLink.url,
        });
    }
    catch (err) {
        console.error("Stripe onboarding failed:", err);
        res.status(500).json({ error: err.message || "Stripe onboarding failed" });
    }
});
router.get("/:helperId/stripe/status", async (req, res) => {
    try {
        await ensureHelperColumns();
        const { helperId } = req.params;
        const helperResult = await (0, db_1.query)(`SELECT * FROM helpers WHERE id = $1`, [helperId]);
        if (helperResult.rowCount === 0) {
            return res.status(404).json({ error: "Helper not found" });
        }
        const helper = helperResult.rows[0];
        if (!helper.stripe_account_id) {
            return res.json({
                ok: true,
                connected: false,
                onboardingComplete: false,
                chargesEnabled: false,
                payoutsEnabled: false,
            });
        }
        const account = await stripe.accounts.retrieve(helper.stripe_account_id);
        const complete = Boolean(account.charges_enabled && account.payouts_enabled);
        await (0, db_1.query)(`UPDATE helpers SET stripe_onboarding_complete = $1 WHERE id = $2`, [complete, helperId]);
        res.json({
            ok: true,
            connected: true,
            stripeAccountId: helper.stripe_account_id,
            onboardingComplete: complete,
            chargesEnabled: account.charges_enabled,
            payoutsEnabled: account.payouts_enabled,
            requirements: account.requirements?.currently_due || [],
        });
    }
    catch (err) {
        console.error("Stripe status failed:", err);
        res.status(500).json({ error: err.message || "Stripe status failed" });
    }
});
router.post("/:helperId/profile-picture", upload.single("profilePicture"), async (req, res) => {
    try {
        await ensureHelperColumns();
        const { helperId } = req.params;
        if (!req.file) {
            return res.status(400).json({ error: "profilePicture file is required" });
        }
        const imageUrl = await new Promise((resolve, reject) => {
            const stream = cloudinary_1.v2.uploader.upload_stream({
                folder: "roadshare/helpers",
                public_id: `helper_${helperId}_${Date.now()}`,
                resource_type: "image",
                overwrite: true,
                transformation: [
                    { width: 600, height: 600, crop: "fill", gravity: "face" },
                    { quality: "auto", fetch_format: "auto" },
                ],
            }, (error, result) => {
                if (error || !result?.secure_url) {
                    reject(error || new Error("Cloudinary upload failed"));
                    return;
                }
                resolve(result.secure_url);
            });
            stream.end(req.file.buffer);
        });
        const result = await (0, db_1.query)(`
      UPDATE helpers
      SET profile_photo_url = $1
      WHERE id = $2
      RETURNING *
      `, [imageUrl, helperId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Helper not found" });
        }
        res.json({ ok: true, helper: result.rows[0] });
    }
    catch (err) {
        console.error("Profile upload failed:", err);
        res.status(500).json({ error: err.message || "Profile upload failed" });
    }
});
exports.default = router;
