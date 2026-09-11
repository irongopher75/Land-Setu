import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { app } from './firebase';

const db = getFirestore(app);

export { db, doc, setDoc };
