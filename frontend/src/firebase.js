import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection } from "firebase/firestore";

// Firebase Configuration for project: landsetu-e4e5e
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCevzugIJpY-dF6Rrg_JZKGBL6ynfDY3Nk",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "landsetu-e4e5e.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "landsetu-e4e5e",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "landsetu-e4e5e.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "444994327661",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:444994327661:web:ecaca48f0700f91fd01b64"
};

// Initialize Firebase App & Services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { 
  app, 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  collection
};
