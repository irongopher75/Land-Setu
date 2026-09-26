import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc, deleteDoc } from 'firebase/firestore';
import { app, auth } from './firebase';
import { describeFirestoreError } from './syncNotice';

let db = null;
try {
  if (app) {
    db = getFirestore(app);
  }
} catch (err) {
  console.warn("Firestore initialization notice:", err.message);
}

const prepareFirestoreData = (data) => {
  if (!data) return data;
  const clone = JSON.parse(JSON.stringify(data));
  if (clone.geometry && typeof clone.geometry === 'object') {
    clone.geometry_json = JSON.stringify(clone.geometry);
    delete clone.geometry;
  }
  return clone;
};

const parseFirestoreData = (data) => {
  if (!data) return data;
  const clone = { ...data };
  if (clone.geometry_json && typeof clone.geometry_json === 'string') {
    try {
      clone.geometry = JSON.parse(clone.geometry_json);
    } catch (e) {}
  }
  return clone;
};

// Writes throw an Error with a plain-language message when the store refuses or fails, so the caller can
// tell the user. They never fail silently.
const firestoreWrite = async (write) => {
  if (!db) throw new Error(describeFirestoreError(null));
  try {
    await write();
  } catch (err) {
    throw Object.assign(new Error(describeFirestoreError(err)), { code: err.code });
  }
};

// custom_parcels is read-only for browsers (firestore.rules). A parcel's live record is written only by the
// records service, which computes area and state itself and is the only party that can attest a
// departmental record.

export const saveBoundaryRequestToFirestore = (reqData) => firestoreWrite(async () => {
  const docData = prepareFirestoreData(reqData);
  await setDoc(doc(db, 'boundary_requests', reqData.id), {
    ...docData,
    status: reqData.status,
    requesterUid: auth?.currentUser?.uid || '',
    createdAt: new Date().toISOString()
  });
});

export const updateBoundaryRequestInFirestore = (reqId, status, approverRole) => firestoreWrite(async () => {
  await updateDoc(doc(db, 'boundary_requests', String(reqId)), {
    status,
    approverRole,
    approvedAt: new Date().toISOString()
  });
});

export const getFirestoreCustomParcels = async () => {
  try {
    const snap = await getDocs(collection(db, 'custom_parcels'));
    const parcels = {};
    snap.forEach(d => {
      parcels[d.id] = parseFirestoreData(d.data());
    });
    return parcels;
  } catch (err) {
    console.warn('Firestore fetch custom parcels notice:', err.message);
    return {};
  }
};

export const getFirestoreCustomParcel = async (ulpin) => {
  try {
    const pRef = doc(db, 'custom_parcels', ulpin);
    const snap = await getDoc(pRef);
    if (snap.exists()) {
      return parseFirestoreData(snap.data());
    }
    return null;
  } catch (err) {
    console.warn('Firestore fetch custom parcel by ULPIN notice:', err.message);
    return null;
  }
};

export const getFirestorePendingRequests = async () => {
  try {
    const openStatuses = ['PENDING_AUDITOR_REVIEW', 'PENDING_STATE_ADMIN', 'PENDING_APPROVAL', 'PENDING', 'PENDING_DELETION_VILLAGE', 'PENDING_DELETION_AUDITOR'];
    const snap = await getDocs(collection(db, 'boundary_requests'));
    const reqs = [];
    snap.forEach(d => {
      const data = parseFirestoreData(d.data());
      if (openStatuses.includes(data.status)) {
        reqs.push({ id: d.id, ...data });
      }
    });
    return reqs;
  } catch (err) {
    console.warn('Firestore fetch requests notice:', err.message);
    return [];
  }
};

// The marker must name the deletion request that completed every stage (firestore.rules).
export const markParcelDeletedInFirestore = (ulpin, requestId) => firestoreWrite(async () => {
  await setDoc(doc(db, 'deleted_parcels', ulpin), {
    ulpin,
    requestId: String(requestId),
    deletedAt: new Date().toISOString()
  });
});

// Profile of the signed-in user (users/{uid}). Optional fields are left out rather than sent as null, which
// the rules reject.
export const saveUserProfileToFirestore = (user) => firestoreWrite(async () => {
  const profile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email.split('@')[0],
    lastLogin: new Date().toISOString()
  };
  if (user.photoURL) profile.photoURL = user.photoURL;
  await setDoc(doc(db, 'users', user.uid), profile, { merge: true });
});

export const getFirestoreDeletedUlpins = async () => {
  try {
    const snap = await getDocs(collection(db, 'deleted_parcels'));
    const ulpins = [];
    snap.forEach(d => ulpins.push(d.id));
    return ulpins;
  } catch (err) {
    console.warn('Firestore fetch deleted parcels notice:', err.message);
    return [];
  }
};

export const getFirestoreBoundaryRequest = async (reqId) => {
  try {
    const reqRef = doc(db, 'boundary_requests', reqId);
    const snap = await getDoc(reqRef);
    if (snap.exists()) {
      return parseFirestoreData({ id: snap.id, ...snap.data() });
    }
    return null;
  } catch (err) {
    console.warn('Firestore fetch request by ID notice:', err.message);
    return null;
  }
};

export { db, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc, deleteDoc };
