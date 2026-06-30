// Firebase initialization for AscendU.
// Config is read from Vite env vars (see .env.example). Fill in .env.local with
// your project's values from the Firebase console → Project settings → Your apps.

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// A friendly nudge if env vars are missing, so the app fails loudly, not silently.
if (!firebaseConfig.apiKey) {
  console.error(
    "Firebase config is missing. Copy .env.example to .env.local and fill in your " +
    "project values from the Firebase console."
  );
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
