import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc, deleteDoc } from 'firebase/firestore';
import { app } from './firebase';

const db = getFirestore(app);

export const saveCustomParcelToFirestore = async (parcelData) => {
  try {
    const pRef = doc(db, 'custom_parcels', parcelData.ulpin);
    await setDoc(pRef, {
      ...parcelData,
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
    const reqRef = doc(db, 'boundary_requests', reqData.id);
    await setDoc(reqRef, {
      ...reqData,
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
      parcels[d.id] = d.data();
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
      return snap.data();
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
      const data = d.data();
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

export { db, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc, deleteDoc };
