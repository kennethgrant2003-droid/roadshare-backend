import {
  cert,
  getApp,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import {
  getFirestore as getAdminFirestore,
} from "firebase-admin/firestore";

function getFirebaseApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n"
    );

  if (
    !projectId ||
    !clientEmail ||
    !privateKey
  ) {
    throw new Error(
      "Firebase Admin environment variables are missing."
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export function getFirestore() {
  const app = getFirebaseApp();

  return getAdminFirestore(app);
}
