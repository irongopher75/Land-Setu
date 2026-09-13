import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc, deleteDoc } from 'firebase/firestore';
import { app } from './firebase';

const db = getFirestore(app);

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

export const saveCustomParcelToFirestore = async (parcelData) => {
  try {
    const docData = prepareFirestoreData(parcelData);
    const pRef = doc(db, 'custom_parcels', parcelData.ulpin);
    await setDoc(pRef, {
      ...docData,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore custom parcel sync notice:', err.message);
  }
};

export const deleteCustomParcelFromFirestore = async (ulpin) => {
  try {
    const pRef = doc(db, 'custom_parcels', ulpin);
    await deleteDoc(pRef);
  } catch (err) {
    console.warn('Firestore delete parcel notice:', err.message);
  }
};

export const saveBoundaryRequestToFirestore = async (reqData) => {
  try {
    const docData = prepareFirestoreData(reqData);
    const reqRef = doc(db, 'boundary_requests', reqData.id);
    await setDoc(reqRef, {
      ...docData,
      status: reqData.status || 'PENDING',
      createdAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore boundary request sync notice:', err.message);
  }
};

export const updateBoundaryRequestInFirestore = async (reqId, status, approverRole) => {
  try {
    const reqRef = doc(db, 'boundary_requests', reqId);
    await updateDoc(reqRef, {
      status,
      approverRole,
      approvedAt: new Date().toISOString()
    });
  } catch (err) {
    console.warn('Firestore update request notice:', err.message);
  }
};

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

export const markParcelDeletedInFirestore = async (ulpin) => {
  try {
    const pRef = doc(db, 'deleted_parcels', ulpin);
    await setDoc(pRef, {
      ulpin,
      deletedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore deleted parcel sync notice:', err.message);
  }
};

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

export const saveDeedBlockToFirestore = async (blockData) => {
  try {
    const docId = `${blockData.ulpin}_BLK_${blockData.blockHeight}_${blockData.currentHash.substring(2, 10)}`;
    const bRef = doc(db, 'deed_blockchain', docId);
    await setDoc(bRef, {
      ...blockData,
      createdAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore save deed block notice:', err.message);
  }
};

export const getFirestoreDeedBlocks = async (ulpin) => {
  try {
    const q = query(collection(db, 'deed_blockchain'), where('ulpin', '==', ulpin));
    const snap = await getDocs(q);
    const blocks = [];
    snap.forEach(d => {
      blocks.push(d.data());
    });
    return blocks;
  } catch (err) {
    console.warn('Firestore fetch deed blocks notice:', err.message);
    return [];
  }
};

export { db, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc, deleteDoc };
