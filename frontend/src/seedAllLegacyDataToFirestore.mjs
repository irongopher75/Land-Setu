import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCevzugIJpY-dF6Rrg_JZKGBL6ynfDY3Nk",
  authDomain: "landsetu-e4e5e.firebaseapp.com",
  projectId: "landsetu-e4e5e",
  storageBucket: "landsetu-e4e5e.firebasestorage.app",
  messagingSenderId: "444994327661",
  appId: "1:444994327661:web:ecaca48f0700f91fd01b64"
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

// All Tamil Nadu Legacy Parcels (9 parcels) + Geometry + Rule Flags
const tnGeometries = {
  "TN-CHN-0042-1187": [[[80.2700, 13.0820], [80.2725, 13.0820], [80.2725, 13.0840], [80.2700, 13.0840], [80.2700, 13.0820]]],
  "TN-CHN-0042-1188": [[[80.2720, 13.0830], [80.2745, 13.0830], [80.2745, 13.0850], [80.2720, 13.0850], [80.2720, 13.0830]]],
  "TN-CHN-0042-1189": [[[80.2750, 13.0820], [80.2770, 13.0820], [80.2770, 13.0840], [80.2750, 13.0840], [80.2750, 13.0820]]],
  "TN-CHN-0042-1190": [[[80.2700, 13.0845], [80.2725, 13.0845], [80.2725, 13.0865], [80.2700, 13.0865], [80.2700, 13.0845]]],
  "TN-CHN-0042-1191": [[[80.2730, 13.0855], [80.2755, 13.0855], [80.2755, 13.0875], [80.2730, 13.0875], [80.2730, 13.0855]]],
  "TN-CHN-0042-1192": [[[80.2760, 13.0845], [80.2785, 13.0845], [80.2785, 13.0865], [80.2760, 13.0865], [80.2760, 13.0845]]],
  "TN-CHN-0042-1193": [[[80.2670, 13.0820], [80.2695, 13.0820], [80.2695, 13.0840], [80.2670, 13.0840], [80.2670, 13.0820]]],
  "TN-CHN-0042-1194": [[[80.2670, 13.0845], [80.2695, 13.0845], [80.2695, 13.0865], [80.2670, 13.0865], [80.2670, 13.0845]]],
  "TN-CHN-0042-1195": [[[80.2790, 13.0820], [80.2815, 13.0820], [80.2815, 13.0840], [80.2790, 13.0840], [80.2790, 13.0820]]]
};

const tnParcels = [
  {
    ulpin: "TN-CHN-0042-1187",
    state: "TamilNadu",
    area_sqm: 452.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1187"] },
    layers: {
      ror: { owner_name: "R. Kannan", owner_share: "1/1", khata_no: "KH-1187", source: "revenue_dept", last_verified: "2019-03-14", confidence: "verified" },
      registration: { last_transaction_id: "REG-2019-88213", transaction_type: "sale", date: "2019-03-14", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2022-441", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 42000, source: "revenue_dept", confidence: "stale", last_verified: "2016-01-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "boundary_overlap", flag: true, reason: "Boundary intersects with parcel TN-CHN-0042-1188", evidence: { overlapping_parcel: "TN-CHN-0042-1188", overlap_area_sqm: 14.2 } },
      { rule: "stale_confidence", flag: true, reason: "Tax last verified over 3 years ago (2016-01-01)", evidence: { last_verified: "2016-01-01" } }
    ]
  },
  {
    ulpin: "TN-CHN-0042-1188",
    state: "TamilNadu",
    area_sqm: 520.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1188"] },
    layers: {
      ror: { owner_name: "M. Selvam", owner_share: "1/1", khata_no: "KH-1188", source: "revenue_dept", last_verified: "2021-08-20", confidence: "verified" },
      registration: { last_transaction_id: "REG-2021-90112", transaction_type: "sale", date: "2021-08-20", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2022-490", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 38000, source: "revenue_dept", confidence: "verified", last_verified: "2024-02-10" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "boundary_overlap", flag: true, reason: "Boundary intersects with parcel TN-CHN-0042-1187", evidence: { overlapping_parcel: "TN-CHN-0042-1187", overlap_area_sqm: 14.2 } }
    ]
  },
  {
    ulpin: "TN-CHN-0042-1189",
    state: "TamilNadu",
    area_sqm: 610.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1189"] },
    layers: {
      ror: { owner_name: "V. Ramanathan", owner_share: "1/1", khata_no: "KH-1189", source: "revenue_dept", last_verified: "2020-11-05", confidence: "verified" },
      registration: { last_transaction_id: "REG-2020-55410", transaction_type: "sale", date: "2020-11-05", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2021-102", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 51000, source: "revenue_dept", confidence: "verified", last_verified: "2023-11-15" },
      encumbrance: { active: true, type: "Bank Mortgage Lien", source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "ownership_mismatch", flag: true, reason: "RoR owner 'V. Ramanathan' differs from Registration owner 'A. Sundaram'", evidence: { ror_owner: "V. Ramanathan", reg_owner: "A. Sundaram" } },
      { rule: "active_encumbrance", flag: true, reason: "Active Bank Mortgage Lien registered against parcel", evidence: { encumbrance_type: "Bank Mortgage Lien" } }
    ]
  },
  {
    ulpin: "TN-CHN-0042-1190",
    state: "TamilNadu",
    area_sqm: 380.0,
    land_use: "commercial",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1190"] },
    layers: {
      ror: { owner_name: "S. Lakshmi", owner_share: "1/1", khata_no: "KH-1190", source: "revenue_dept", last_verified: "2022-04-12", confidence: "verified" },
      registration: { last_transaction_id: "REG-2022-33219", transaction_type: "sale", date: "2022-04-12", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "commercial", permitted_fsi: 2.0, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2023-088", approved_fsi: 2.8, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 75000, source: "revenue_dept", confidence: "verified", last_verified: "2024-01-05" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "zoning_violation", flag: true, reason: "Approved FSI (2.8) exceeds maximum permitted FSI (2.0)", evidence: { approved_fsi: 2.8, permitted_fsi: 2.0 } }
    ]
  },
  {
    ulpin: "TN-CHN-0042-1191",
    state: "TamilNadu",
    area_sqm: 490.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1191"] },
    layers: {
      ror: { owner_name: "P. Murugan", owner_share: "1/1", khata_no: "KH-1191", source: "revenue_dept", last_verified: "2018-09-01", confidence: "verified" },
      registration: { last_transaction_id: "REG-2018-12490", transaction_type: "sale", date: "2018-09-01", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2019-301", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 32000, source: "revenue_dept", confidence: "stale", last_verified: "2015-06-20" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "stale_confidence", flag: true, reason: "Tax record last updated over 3 years ago (2015-06-20)", evidence: { last_verified: "2015-06-20" } }
    ]
  },
  {
    ulpin: "TN-CHN-0042-1192",
    state: "TamilNadu",
    area_sqm: 750.0,
    land_use: "commercial",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1192"] },
    layers: {
      ror: { owner_name: "K. Jayaraman", owner_share: "1/1", khata_no: "KH-1192", source: "revenue_dept", last_verified: "2023-01-25", confidence: "verified" },
      registration: { last_transaction_id: "REG-2023-10042", transaction_type: "sale", date: "2023-01-25", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "commercial", permitted_fsi: 2.0, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2023-402", approved_fsi: 2.0, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 88000, source: "revenue_dept", confidence: "verified", last_verified: "2024-05-12" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "TN-CHN-0042-1193",
    state: "TamilNadu",
    area_sqm: 410.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1193"] },
    layers: {
      ror: { owner_name: "D. Anitha", owner_share: "1/1", khata_no: "KH-1193", source: "revenue_dept", last_verified: "2022-10-18", confidence: "verified" },
      registration: { last_transaction_id: "REG-2022-77182", transaction_type: "sale", date: "2022-10-18", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2023-119", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 45000, source: "revenue_dept", confidence: "verified", last_verified: "2024-03-30" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "TN-CHN-0042-1194",
    state: "TamilNadu",
    area_sqm: 580.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1194"] },
    layers: {
      ror: { owner_name: "G. Balaji", owner_share: "1/1", khata_no: "KH-1194", source: "revenue_dept", last_verified: "2021-02-14", confidence: "verified" },
      registration: { last_transaction_id: "REG-2021-44019", transaction_type: "sale", date: "2021-02-14", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2021-994", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 49000, source: "revenue_dept", confidence: "verified", last_verified: "2023-09-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "TN-CHN-0042-1195",
    state: "TamilNadu",
    area_sqm: 630.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: tnGeometries["TN-CHN-0042-1195"] },
    layers: {
      ror: { owner_name: "T. Radhakrishnan", owner_share: "1/1", khata_no: "KH-1195", source: "revenue_dept", last_verified: "2017-05-10", confidence: "verified" },
      registration: { last_transaction_id: "REG-2017-09112", transaction_type: "sale", date: "2017-05-10", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.5, eco_sensitive: false, source: "master_plan_2023", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BP-2018-005", approved_fsi: 1.5, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 41000, source: "revenue_dept", confidence: "stale", last_verified: "2017-05-10" },
      encumbrance: { active: true, type: "State Tax Lien", source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "active_encumbrance", flag: true, reason: "Active State Tax Lien registered against parcel", evidence: { encumbrance_type: "State Tax Lien" } }
    ]
  }
];

// All Chandigarh Legacy Parcels (8 parcels)
const chdGeometries = {
  "CHD-SEC-0017-0201": [[[76.7750, 30.7320], [76.7775, 30.7320], [76.7775, 30.7340], [76.7750, 30.7340], [76.7750, 30.7320]]],
  "CHD-SEC-0017-0202": [[[76.7780, 30.7320], [76.7805, 30.7320], [76.7805, 30.7340], [76.7780, 30.7340], [76.7780, 30.7320]]],
  "CHD-SEC-0017-0203": [[[76.7840, 30.7370], [76.7860, 30.7370], [76.7860, 30.7390], [76.7840, 30.7390], [76.7840, 30.7370]]],
  "CHD-SEC-0017-0204": [[[76.7750, 30.7345], [76.7775, 30.7345], [76.7775, 30.7365], [76.7750, 30.7365], [76.7750, 30.7345]]],
  "CHD-SEC-0017-0205": [[[76.7780, 30.7345], [76.7805, 30.7345], [76.7805, 30.7365], [76.7780, 30.7365], [76.7780, 30.7345]]],
  "CHD-SEC-0017-0206": [[[76.7720, 30.7320], [76.7745, 30.7320], [76.7745, 30.7340], [76.7720, 30.7340], [76.7720, 30.7320]]],
  "CHD-SEC-0017-0207": [[[76.7720, 30.7345], [76.7745, 30.7345], [76.7745, 30.7365], [76.7720, 30.7365], [76.7720, 30.7345]]],
  "CHD-SEC-0017-0208": [[[76.7810, 30.7320], [76.7830, 30.7320], [76.7830, 30.7340], [76.7810, 30.7340], [76.7810, 30.7320]]]
};

const chdParcels = [
  {
    ulpin: "CHD-SEC-0017-0201",
    state: "Chandigarh",
    area_sqm: 460.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0201"] },
    layers: {
      ror: { owner_name: "Harpreet Singh", owner_share: "1/1", khata_no: "CHD-201", source: "estate_office", last_verified: "2021-06-15", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2021-998", transaction_type: "sale", date: "2021-06-15", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.2, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2021-088", approved_fsi: 1.2, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 65000, source: "revenue_dept", confidence: "verified", last_verified: "2024-03-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "CHD-SEC-0017-0202",
    state: "Chandigarh",
    area_sqm: 501.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0202"] },
    layers: {
      ror: { owner_name: "Gurpreet Kaur", owner_share: "1/1", khata_no: "CHD-202", source: "estate_office", last_verified: "2020-04-10", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2020-412", transaction_type: "sale", date: "2020-04-10", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.2, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2020-142", approved_fsi: 1.2, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 72000, source: "revenue_dept", confidence: "verified", last_verified: "2024-02-15" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "CHD-SEC-0017-0203",
    state: "Chandigarh",
    area_sqm: 401.0,
    land_use: "ecological",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0203"] },
    layers: {
      ror: { owner_name: "Rajesh Sharma", owner_share: "1/1", khata_no: "CHD-203", source: "estate_office", last_verified: "2019-11-20", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2019-110", transaction_type: "sale", date: "2019-11-20", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "ecological", permitted_fsi: 0.5, eco_sensitive: true, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2022-301", approved_fsi: 1.8, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 55000, source: "revenue_dept", confidence: "verified", last_verified: "2023-10-10" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "protected_zone_containment", flag: true, reason: "Parcel geometry falls inside Sukhna Lake Protected Eco-Zone", evidence: { zone_id: "ECO-ZONE-CHD-01", zone_name: "Sukhna Lake Protected Eco-Zone" } },
      { rule: "zoning_violation", flag: true, reason: "Approved FSI (1.8) exceeds permitted FSI (0.5) for eco-sensitive zone", evidence: { approved_fsi: 1.8, permitted_fsi: 0.5 } }
    ]
  },
  {
    ulpin: "CHD-SEC-0017-0204",
    state: "Chandigarh",
    area_sqm: 435.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0204"] },
    layers: {
      ror: { owner_name: "Simranjeet Singh", owner_share: "1/1", khata_no: "CHD-204", source: "estate_office", last_verified: "2022-09-05", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2022-781", transaction_type: "sale", date: "2022-09-05", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.2, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2023-012", approved_fsi: 1.2, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 68000, source: "revenue_dept", confidence: "verified", last_verified: "2024-04-20" },
      encumbrance: { active: true, type: "Mortgage Hypothecation", source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "active_encumbrance", flag: true, reason: "Active Mortgage Hypothecation registered against parcel", evidence: { encumbrance_type: "Mortgage Hypothecation" } }
    ]
  },
  {
    ulpin: "CHD-SEC-0017-0205",
    state: "Chandigarh",
    area_sqm: 627.0,
    land_use: "commercial",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0205"] },
    layers: {
      ror: { owner_name: "Amit Verma", owner_share: "1/1", khata_no: "CHD-205", source: "estate_office", last_verified: "2018-01-14", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2018-009", transaction_type: "sale", date: "2018-01-14", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "commercial", permitted_fsi: 2.0, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2018-990", approved_fsi: 2.0, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 120000, source: "revenue_dept", confidence: "stale", last_verified: "2016-08-11" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: [
      { rule: "ownership_mismatch", flag: true, reason: "RoR owner 'Amit Verma' differs from Deed owner 'Vikram Malhotra'", evidence: { ror_owner: "Amit Verma", reg_owner: "Vikram Malhotra" } },
      { rule: "stale_confidence", flag: true, reason: "Tax record last updated over 3 years ago (2016-08-11)", evidence: { last_verified: "2016-08-11" } }
    ]
  },
  {
    ulpin: "CHD-SEC-0017-0206",
    state: "Chandigarh",
    area_sqm: 351.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0206"] },
    layers: {
      ror: { owner_name: "Neha Gupta", owner_share: "1/1", khata_no: "CHD-206", source: "estate_office", last_verified: "2023-03-18", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2023-221", transaction_type: "sale", date: "2023-03-18", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.2, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2023-411", approved_fsi: 1.2, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 50000, source: "revenue_dept", confidence: "verified", last_verified: "2024-01-10" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "CHD-SEC-0017-0207",
    state: "Chandigarh",
    area_sqm: 568.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0207"] },
    layers: {
      ror: { owner_name: "Kuldeep Malhotra", owner_share: "1/1", khata_no: "CHD-207", source: "estate_office", last_verified: "2021-12-01", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2021-552", transaction_type: "sale", date: "2021-12-01", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.2, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2022-105", approved_fsi: 1.2, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 81000, source: "revenue_dept", confidence: "verified", last_verified: "2023-12-05" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  },
  {
    ulpin: "CHD-SEC-0017-0208",
    state: "Chandigarh",
    area_sqm: 426.0,
    land_use: "residential",
    geometry: { type: "Polygon", coordinates: chdGeometries["CHD-SEC-0017-0208"] },
    layers: {
      ror: { owner_name: "Manpreet Kaur", owner_share: "1/1", khata_no: "CHD-208", source: "estate_office", last_verified: "2022-07-22", confidence: "verified" },
      registration: { last_transaction_id: "DEED-2022-901", transaction_type: "sale", date: "2022-07-22", source: "sub_registrar", confidence: "verified" },
      zoning: { land_use: "residential", permitted_fsi: 1.2, eco_sensitive: false, source: "master_plan", confidence: "verified" },
      building_permit: { status: "approved", permit_id: "BL-2022-887", approved_fsi: 1.2, source: "municipal_corp", confidence: "verified" },
      tax: { annual_value: 62000, source: "revenue_dept", confidence: "verified", last_verified: "2024-05-01" },
      encumbrance: { active: false, type: null, source: "sub_registrar", confidence: "verified" }
    },
    flags: []
  }
];

const protectedZones = [
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

async function seedLegacyData() {
  console.log("Seeding ALL Legacy Data (17 parcels + eco-zones + rule flags) to Cloud Firestore online...");

  const allParcels = [...tnParcels, ...chdParcels];

  for (const parcel of allParcels) {
    const docData = prepareForFirestore(parcel);
    const pRef = doc(db, "custom_parcels", parcel.ulpin);
    await setDoc(pRef, docData, { merge: true });
    console.log(`✓ Seeded legacy parcel custom_parcels/${parcel.ulpin}`);
  }

  for (const zone of protectedZones) {
    const docData = prepareForFirestore(zone);
    const zRef = doc(db, "protected_zones", zone.id);
    await setDoc(zRef, docData, { merge: true });
    console.log(`✓ Seeded legacy zone protected_zones/${zone.id}`);
  }

  console.log("🎉 ALL Legacy Data successfully populated to Cloud Firestore online database!");
  process.exit(0);
}

seedLegacyData().catch(err => {
  console.error("Legacy Seeding failed:", err);
  process.exit(1);
});
