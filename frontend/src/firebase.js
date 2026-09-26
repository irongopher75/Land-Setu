import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  connectAuthEmulator,
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";

// Firebase Configuration - loaded exclusively from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

// Dev only: use the local Firebase emulators instead of the real project.
// Off unless VITE_USE_AUTH_EMULATOR is exactly "true". No committed env file sets it.
export const USE_EMULATORS = import.meta.env.VITE_USE_AUTH_EMULATOR === 'true';
let authEmulatorConnected = false;

// Initialize Firebase App & Services safely
let app = null;
let auth = null;
let googleProvider = null;

try {
  if (firebaseConfig.apiKey && firebaseConfig.apiKey.length > 5 && !firebaseConfig.apiKey.includes('your-actual-api-key')) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    if (USE_EMULATORS && !authEmulatorConnected && !auth.emulatorConfig) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      authEmulatorConnected = true;
    }
    googleProvider = new GoogleAuthProvider();
  } else {
    console.warn("Firebase configuration incomplete or default placeholder active. Operating in fallback mode.");
  }
} catch (err) {
  console.warn("Firebase Auth initialization notice:", err.message);
}

export { 
  app, 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut, 
  onAuthStateChanged
};
