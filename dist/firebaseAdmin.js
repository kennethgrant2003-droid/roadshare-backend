"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirestore = getFirestore;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
function getFirebaseApp() {
    if ((0, app_1.getApps)().length > 0) {
        return (0, app_1.getApp)();
    }
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!projectId ||
        !clientEmail ||
        !privateKey) {
        throw new Error("Firebase Admin environment variables are missing.");
    }
    return (0, app_1.initializeApp)({
        credential: (0, app_1.cert)({
            projectId,
            clientEmail,
            privateKey,
        }),
    });
}
function getFirestore() {
    const app = getFirebaseApp();
    return (0, firestore_1.getFirestore)(app);
}
