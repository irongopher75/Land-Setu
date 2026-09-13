import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.VITE_FIREBASE_APP_ID || ""
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const prepareForFirestore = (obj) => {
  const clone = JSON.parse(JSON.stringify(obj));
  if (clone.geometry) {
    clone.geometry_json = JSON.stringify(clone.geometry);
    delete clone.geometry;
  }
  return clone;
};

const sampleParcels = [
  {
    ulpin: "TN-CHN-0042-1187",
    state: "TamilNadu",
    area_sqm: 452.3,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: [[[80.2700, 13.0820], [80.2725, 13.0820], [80.2725, 13.0840], [80.2700, 13.0840], [80.2700, 13.0820]]] },
    layers: {
      ror: { owner_name: "R. Kannan", owner_share: "1/1", khata_no: "KH-1187", source: "registration_dept", last_verified: "2023-03-14", confidence: "verified" },
      registration: { last_transaction_id: "REG-2023-88213", transaction_type: "sale", date: "2023-03-14", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2023-441", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 42000, source: "revenue_dept", confidence: "verified", last_verified: "2023-01-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "TN-CHN-0042-1188",
    state: "TamilNadu",
    area_sqm: 620.5,
    land_use: "agricultural",
    geometry: { type: "Polygon", coordinates: [[[80.2720, 13.0830], [80.2745, 13.0830], [80.2745, 13.0850], [80.2720, 13.0850], [80.2720, 13.0830]]] },
    layers: {
      ror: { owner_name: "S. Murugan", owner_share: "1/1", khata_no: "KH-1188", source: "revenue_dept", last_verified: "2023-05-10", confidence: "verified" },
      registration: { last_transaction_id: "REG-2023-99102", transaction_type: "sale", date: "2023-05-10", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "agricultural", permitted_fsi: 0.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2023-502", approved_fsi: 0.5, source: "panchayat", confidence: "verified" },
      tax: { annual_value: 18000, source: "revenue_dept", confidence: "verified", last_verified: "2023-01-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "TN-CHN-0042-1189",
    state: "TamilNadu",
    area_sqm: 850.0,
    land_use: "industrial",
    geometry: { type: "Polygon", coordinates: [[[80.2750, 13.0820], [80.2770, 13.0820], [80.2770, 13.0840], [80.2750, 13.0840], [80.2750, 13.0820]]] },
    layers: {
      ror: { owner_name: "K. Venkatesh", owner_share: "1/1", khata_no: "KH-1189", source: "revenue_dept", last_verified: "2023-02-15", confidence: "verified" },
      registration: { last_transaction_id: "REG-2023-11029", transaction_type: "lease", date: "2023-02-15", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "industrial", permitted_fsi: 2.0, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2023-991", approved_fsi: 2.0, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 125000, source: "revenue_dept", confidence: "verified", last_verified: "2023-01-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "TN-CHN-0042-1190",
    state: "TamilNadu",
    area_sqm: 410.0,
    land_use: "ecological",
    geometry: { type: "Polygon", coordinates: [[[80.2700, 13.0845], [80.2725, 13.0845], [80.2725, 13.0865], [80.2700, 13.0865], [80.2700, 13.0845]]] },
    layers: {
      ror: { owner_name: "M. Lakshmi", owner_share: "1/1", khata_no: "KH-1190", source: "revenue_dept", last_verified: "2023-08-20", confidence: "verified" },
      registration: { last_transaction_id: "REG-2023-33201", transaction_type: "sale", date: "2023-08-20", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "ecological", permitted_fsi: 0.2, eco_sensitive: true, source: "forest_dept", confidence: "verified" },
      building_permit: { status: "rejected", permit_id: "BP-2023-004", approved_fsi: 0.0, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 22000, source: "revenue_dept", confidence: "verified", last_verified: "2023-01-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "CHD-SEC-0017-0201",
    state: "Chandigarh",
    area_sqm: 540.0,
    land_use: "commercial",
    geometry: { type: "Polygon", coordinates: [[[76.7750, 30.7320], [76.7775, 30.7320], [76.7775, 30.7340], [76.7750, 30.7340], [76.7750, 30.7320]]] },
    layers: {
      ror: { owner_name: "Gurpreet Singh", owner_share: "1/1", khata_no: "CHD-SEC-17-994", source: "revenue_dept", last_verified: "2023-04-12", confidence: "verified" },
      registration: { last_transaction_id: "CHD-REG-2023-0091", transaction_type: "sale", date: "2023-04-12", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "commercial", permitted_fsi: 2.0, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "CHD-BL-2023-108", approved_fsi: 1.8, source: "estate_office", confidence: "verified" },
      tax: { annual_value: 95000, source: "revenue_dept", confidence: "verified", last_verified: "2023-04-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "MH-PUNE-712-4491",
    state: "Maharashtra",
    area_sqm: 450.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: [[[72.8750, 19.0740], [72.8780, 19.0740], [72.8780, 19.0770], [72.8750, 19.0770], [72.8750, 19.0740]]] },
    layers: {
      ror: { owner_name: "Devendra Sharad Fadnavis", owner_share: "1/1", khata_no: "MH-712-4491", source: "revenue_dept", last_verified: "2023-11-12", confidence: "verified" },
      registration: { last_transaction_id: "MH-PUNE-2023-5512", transaction_type: "sale", date: "2023-11-12", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.75, eco_sensitive: false, source: "town_planning", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "PMC-BP-2023-88", approved_fsi: 1.75, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 58000, source: "revenue_dept", confidence: "verified", last_verified: "2023-03-31" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  }
];

const sampleProtectedZones = [
  {
    id: "ECO-ZONE-TN-01",
    zone_id: "ECO-ZONE-TN-01",
    name: "Guindy Forest Buffer Zone",
    type: "protected_zone",
    state: "TamilNadu",
    geometry: { type: "Polygon", coordinates: [[[80.2650, 13.0800], [80.2850, 13.0800], [80.2850, 13.0815], [80.2650, 13.0815], [80.2650, 13.0800]]] }
  },
  {
    id: "ECO-ZONE-CHD-01",
    zone_id: "ECO-ZONE-CHD-01",
    name: "Sukhna Lake Protected Eco-Zone",
    type: "protected_zone",
    state: "Chandigarh",
    geometry: { type: "Polygon", coordinates: [[[76.7820, 30.7360], [76.7880, 30.7360], [76.7880, 30.7410], [76.7820, 30.7410], [76.7820, 30.7360]]] }
  }
];

const sampleRequests = [
  {
    id: "REQ-1789100021",
    ulpin: "TN-CHN-0042-1187",
    state: "TamilNadu",
    owner_name: "R. Kannan",
    land_use: "residential",
    area_sqm: 452.3,
    requester_role: "village_officer",
    requested_by: "R. Kannan",
    status: "PENDING_AUDITOR_REVIEW",
    created_at: new Date().toISOString(),
    geometry: { type: "Polygon", coordinates: [[[80.2700, 13.0820], [80.2725, 13.0820], [80.2725, 13.0840], [80.2700, 13.0840], [80.2700, 13.0820]]] }
  }
];

async function seedData() {
  console.log("Seeding Cloud Firestore online database (landsetu-e4e5e)...");

  for (const parcel of sampleParcels) {
    const docData = prepareForFirestore(parcel);
    const pRef = doc(db, "custom_parcels", parcel.ulpin);
    await setDoc(pRef, docData, { merge: true });
    console.log(`✓ Seeded custom_parcels/${parcel.ulpin}`);
  }

  for (const zone of sampleProtectedZones) {
    const docData = prepareForFirestore(zone);
    const zRef = doc(db, "protected_zones", zone.id);
    await setDoc(zRef, docData, { merge: true });
    console.log(`✓ Seeded protected_zones/${zone.id}`);
  }

  for (const req of sampleRequests) {
    const docData = prepareForFirestore(req);
    const rRef = doc(db, "boundary_requests", req.id);
    await setDoc(rRef, docData, { merge: true });
    console.log(`✓ Seeded boundary_requests/${req.id}`);
  }

  console.log("🎉 Successfully seeded Cloud Firestore online database!");
  process.exit(0);
}

seedData().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
