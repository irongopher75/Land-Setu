import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import { app, USE_EMULATORS } from './firebase';
import { describeFirestoreError } from './syncNotice';

// Firestore holds only the signed-in user's profile. Parcels, requests, deletions and the ledger live in the
// records service (the API); the browser never reads or writes them here.

let db = null;
let firestoreEmulatorConnected = false;
try {
  if (app) {
    db = getFirestore(app);
    // Same dev-only flag as Auth: emulated users must not read the real Firestore.
    if (USE_EMULATORS && !firestoreEmulatorConnected) {
      connectFirestoreEmulator(db, '127.0.0.1', 8088);
      firestoreEmulatorConnected = true;
    }
  }
} catch (err) {
  console.warn("Firestore initialization notice:", err.message);
}

// Profile of the signed-in user (users/{uid}). Optional fields are left out rather than sent as null, which
// the rules reject. Throws a plain-language Error when the store refuses or fails.
export const saveUserProfileToFirestore = async (user) => {
  if (!db) throw new Error(describeFirestoreError(null));
  const profile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email.split('@')[0],
    lastLogin: new Date().toISOString()
  };
  if (user.photoURL) profile.photoURL = user.photoURL;
  try {
    await setDoc(doc(db, 'users', user.uid), profile, { merge: true });
  } catch (err) {
    throw Object.assign(new Error(describeFirestoreError(err)), { code: err.code });
  }
};
