"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const stripe_1 = __importDefault(require("./routes/stripe"));
const helpers_1 = __importDefault(require("./routes/helpers"));
const tracking_1 = __importDefault(require("./routes/tracking"));
const app = (0, express_1.default)();
app.use("/api/stripe/webhook", express_1.default.raw({ type: "application/json" }));
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get("/health", (_req, res) => {
    res.json({ ok: true, app: "RoadShare API" });
});
// API routes
app.use("/api/stripe", stripe_1.default);
app.use("/api/helpers", helpers_1.default);
app.use("/api/tracking", tracking_1.default);
// Mobile fallback routes because app is calling /helpers/...
app.use("/helpers", helpers_1.default);
app.use("/tracking", tracking_1.default);
app.get("/", (_req, res) => {
    res.send("?? RoadShare backend is running");
});
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`?? RoadShare backend running on http://0.0.0.0:${PORT}`);
});
