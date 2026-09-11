import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc } from 'firebase/firestore';
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

export const saveBoundaryRequestToFirestore = async (reqData) => {
  try {
    const reqRef = doc(db, 'boundary_requests', reqData.id);
    await setDoc(reqRef, {
      ...reqData,
      status: 'PENDING',
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

export const getFirestorePendingRequests = async () => {
  try {
    const q = query(collection(db, 'boundary_requests'), where('status', '==', 'PENDING'));
    const snap = await getDocs(q);
    const reqs = [];
    snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
    return reqs;
  } catch (err) {
    console.warn('Firestore fetch requests notice:', err.message);
    return [];
  }
};

export { db, doc, setDoc, getDoc, collection, getDocs, query, where, updateDoc };
