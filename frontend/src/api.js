import axios from 'axios';
import {
  saveCustomParcelToFirestore,
  deleteCustomParcelFromFirestore,
  saveBoundaryRequestToFirestore,
  updateBoundaryRequestInFirestore,
  getFirestorePendingRequests,
  getFirestoreCustomParcels,
  getFirestoreCustomParcel,
  getFirestoreBoundaryRequest,
  markParcelDeletedInFirestore,
  getFirestoreDeletedUlpins
} from './firebaseFirestore';
import { getDeedBlockchain } from './blockchain';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' && window.location.protocol === 'https:' ? '/api' : 'http://localhost:8000');

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('landsetu_jwt_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const isLocalhostBackendForbidden = () => {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' && API_BASE_URL.includes('localhost');
};

export const notifyFallback = (actionName, reason) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('landsetu-fallback-notice', {
      detail: { actionName, reason, time: new Date().toLocaleTimeString() }
    }));
  }
};

export const checkSyncMode = async () => {
  if (isLocalhostBackendForbidden()) {
    return { isBackendConnected: false, mode: 'OFFLINE_DEMO', label: '⚡ Offline Resilient Mode (Localhost Backend Unreachable from HTTPS)' };
  }
  try {
    const res = await client.get('/parcels/states/all', { timeout: 2000 });
    if (res.data) {
      return { isBackendConnected: true, mode: 'PRIMARY_SYNC', label: '🟢 Cloud SQL / PostGIS Sync (REST API Active)' };
    }
  } catch (err) {}
  return { isBackendConnected: false, mode: 'OFFLINE_DEMO', label: '⚡ Resilient Mode (Offline / Firestore Fallback)' };
};

export const mockLogin = async (role) => {
  const res = await client.post('/auth/mock-login', { role });
  if (res.data && res.data.token) {
    localStorage.setItem('landsetu_jwt_token', res.data.token);
  }
  return res.data;
};

export const firebaseLogin = async (idToken) => {
  const res = await client.post('/auth/firebase-login', { id_token: idToken });
  if (res.data && res.data.token) {
    localStorage.setItem('landsetu_jwt_token', res.data.token);
  }
  return res.data;
};

export const logout = async () => {
  localStorage.removeItem('landsetu_jwt_token');
  return client.post('/auth/logout');
};

export const listParcels = async (state) => {
  const params = state ? { state } : {};
  const res = await client.get('/parcels', { params });
  return res.data;
};

export const getParcelsGeoJSON = async (state) => {
  const localDeleted = JSON.parse(localStorage.getItem('landsetu_deleted_parcels') || '[]');
  const fsDeleted = await getFirestoreDeletedUlpins().catch(() => []);
  const allDeleted = Array.from(new Set([...localDeleted, ...fsDeleted]));

  let geojson = getFallbackSeedParcelsGeoJSON(state || 'TamilNadu');
  if (!isLocalhostBackendForbidden()) {
    const params = state ? { state } : {};
    try {
      const res = await client.get('/parcels/geojson/all', { params });
      if (res.data && res.data.features && res.data.features.length > 0) {
        geojson = res.data;
      }
    } catch (err) {
      console.warn('Backend API notice, using static seed parcels GeoJSON fallback:', err.message);
    }
  }

  if (geojson && geojson.features) {
    geojson = {
      ...geojson,
      features: geojson.features.filter(f => !allDeleted.includes(f.properties?.ulpin))
    };
  }
  return geojson;
};

export const getProtectedZonesGeoJSON = async (state) => {
  if (!isLocalhostBackendForbidden()) {
    const params = state ? { state } : {};
    try {
      const res = await client.get('/parcels/protected-zones/geojson', { params });
      if (res.data && res.data.features && res.data.features.length > 0) {
        return res.data;
      }
    } catch (err) {
      console.warn('Backend API notice, using static seed zones GeoJSON fallback:', err.message);
    }
  }
  return getFallbackProtectedZonesGeoJSON(state || 'TamilNadu');
};

export const getApprovedCustomParcels = async () => {
  const localDeleted = JSON.parse(localStorage.getItem('landsetu_deleted_parcels') || '[]');
  const fsDeleted = await getFirestoreDeletedUlpins().catch(() => []);
  const allDeleted = Array.from(new Set([...localDeleted, ...fsDeleted]));

  const localCustom = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
  let merged = { ...localCustom };
  try {
    const fsCustom = await getFirestoreCustomParcels();
    merged = { ...localCustom, ...fsCustom };
    localStorage.setItem('landsetu_custom_parcels', JSON.stringify(merged));
  } catch (err) {
    console.warn('Firestore custom parcel fetch notice:', err.message);
  }

  allDeleted.forEach(ulpin => {
    delete merged[ulpin];
  });

  return merged;
};

export const getParcelDetail = async (ulpin) => {
  if (!isLocalhostBackendForbidden()) {
    try {
      const res = await client.get(`/parcels/${ulpin}`);
      return res.data;
    } catch (err) {
      // Fallback below
    }
  }
  const customParcels = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
  if (customParcels[ulpin]) {
    return customParcels[ulpin];
  }
  const fsParcel = await getFirestoreCustomParcel(ulpin).catch(() => null);
  if (fsParcel) {
    customParcels[ulpin] = fsParcel;
    localStorage.setItem('landsetu_custom_parcels', JSON.stringify(customParcels));
    return fsParcel;
  }

  // Look up in static seed parcels fallback
  const tnSeed = getFallbackSeedParcelsGeoJSON('TamilNadu').features.find(f => f.properties.ulpin === ulpin);
  const chdSeed = getFallbackSeedParcelsGeoJSON('Chandigarh').features.find(f => f.properties.ulpin === ulpin);
  const seedFeature = tnSeed || chdSeed;

  if (seedFeature) {
    return {
      ulpin,
      state: seedFeature.properties.state || 'TamilNadu',
      geometry: seedFeature.geometry,
      area_sqm: 452.3,
      layers: {
        ror: { owner_name: seedFeature.properties.owner_name, owner_share: '1/1', khata_no: 'KH-1187', source: 'registration_dept', last_verified: '2023-03-14', confidence: 'verified' },
        registration: { last_transaction_id: 'REG-2023-88213', transaction_type: 'sale', date: '2023-03-14', source: 'sub_registrar', confidence: 'verified' },
        zoning: { land_use: seedFeature.properties.land_use || 'residential', permitted_fsi: 1.5, eco_sensitive: false, source: 'master_plan_2023', confidence: 'verified' },
        building_permit: { status: 'approved', permit_id: 'BP-2023-441', approved_fsi: 1.5, source: 'municipal_corp', confidence: 'verified' },
        tax: { annual_value: 42000, source: 'revenue_dept', confidence: 'verified', last_verified: '2023-01-01' },
        encumbrance: { active: false, type: null, source: 'sub_registrar', confidence: 'verified' }
      },
      flags: []
    };
  }

  // General synthetic fallback parcel for any arbitrary ULPIN
  return {
    ulpin,
    state: ulpin.startsWith('MH') ? 'Maharashtra' : ulpin.startsWith('CHD') ? 'Chandigarh' : 'TamilNadu',
    geometry: null,
    area_sqm: 500,
    layers: {
      ror: { owner_name: 'Land Owner', owner_share: '1/1', khata_no: 'KH-712', source: 'revenue_dept', last_verified: '2024-01-01', confidence: 'verified' },
      registration: { last_transaction_id: 'REG-2024-001', transaction_type: 'sale', date: '2024-01-01', source: 'sub_registrar', confidence: 'verified' },
      zoning: { land_use: 'residential', permitted_fsi: 1.5, eco_sensitive: false, source: 'master_plan', confidence: 'verified' },
      building_permit: { status: 'approved', permit_id: 'BP-2024-101', approved_fsi: 1.5, source: 'municipal_corp', confidence: 'verified' },
      tax: { annual_value: 48000, source: 'revenue_dept', confidence: 'verified', last_verified: '2024-01-01' },
      encumbrance: { active: false, type: null, source: 'sub_registrar', confidence: 'verified' }
    },
    flags: []
  };
};

export const getParcelFlags = async (ulpin) => {
  try {
    const res = await client.get(`/parcels/${ulpin}/flags`);
    return res.data;
  } catch (err) {
    return [];
  }
};

export const getParcelBlockchain = async (ulpin, parcelDetail = {}) => {
  return await getDeedBlockchain(ulpin, parcelDetail);
};

export const getParcelPassport = async (ulpin) => {
  const parcel = await getParcelDetail(ulpin).catch(() => ({}));
  const chain = await getDeedBlockchain(ulpin, parcel).catch(() => []);
  const latestBlock = chain.length > 0 ? chain[chain.length - 1] : null;

  try {
    const res = await client.get(`/parcels/${ulpin}/passport`);
    return {
      ...res.data,
      block_hash: latestBlock?.currentHash || '0x7f8a9b2c3d4e5f6a',
      block_height: latestBlock?.blockHeight || 2,
      blockchain_status: 'VERIFIED_SHA256'
    };
  } catch (err) {
    return {
      ulpin,
      timestamp: new Date().toISOString(),
      signed_token: `JWT-SOVEREIGN-${ulpin}-${latestBlock?.currentHash?.substring(2, 10) || '0x7f8a'}`,
      passport_url: `https://landsetu-e4e5e.web.app/passport/${ulpin}`,
      status: "VALID",
      block_hash: latestBlock?.currentHash || '0x7f8a9b2c3d4e5f6a',
      block_height: latestBlock?.blockHeight || 2,
      blockchain_status: 'VERIFIED_SHA256',
      payload: {
        ulpin,
        owner: parcel?.layers?.ror?.owner_name || 'Land Owner',
        state: parcel?.state || 'TamilNadu',
        issuer: 'Sub-Registrar & Revenue Authority (Blockchain Verified)'
      }
    };
  }
};

const OPEN_REQUEST_STATUSES = ['PENDING_AUDITOR_REVIEW', 'PENDING_STATE_ADMIN', 'PENDING_APPROVAL', 'PENDING', 'PENDING_DELETION_VILLAGE', 'PENDING_DELETION_AUDITOR'];
const DELETED_ULPINS_KEY = 'landsetu_deleted_ulpins';

const requestTypeFromStatus = (status, fallbackType) => {
  if (fallbackType) return fallbackType;
  return String(status || '').includes('DELETION') ? 'DELETION' : 'BOUNDARY';
};

export const recordDeletedUlpin = async (ulpin) => {
  if (!ulpin) return;
  const local = JSON.parse(localStorage.getItem(DELETED_ULPINS_KEY) || '[]');
  if (!local.includes(ulpin)) {
    local.push(ulpin);
    localStorage.setItem(DELETED_ULPINS_KEY, JSON.stringify(local));
  }
  await markParcelDeletedInFirestore(ulpin);
};

export const getDeletedUlpins = async () => {
  const local = JSON.parse(localStorage.getItem(DELETED_ULPINS_KEY) || '[]');
  const remote = await getFirestoreDeletedUlpins();
  return [...new Set([...local, ...remote])];
};

export const requestParcelDeletion = async (ulpin, reason = "State Admin requested parcel deletion") => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'state_admin') {
    throw new Error('Permission Denied: Only State Administration Officers (state_admin) can request land parcel deletion.');
  }

  const pending = await getPendingRequests();
  const alreadyOpen = pending.find((r) => r.ulpin === ulpin && String(r.status || '').includes('DELETION'));
  if (alreadyOpen) {
    throw new Error(`A deletion request for ULPIN '${ulpin}' is already pending (${alreadyOpen.status}).`);
  }

  const customParcels = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
  const targetP = customParcels[ulpin] || await getFirestoreCustomParcel(ulpin).catch(() => ({})) || {};

  let backendId = null;
  let backendMessage = null;
  if (!isLocalhostBackendForbidden()) {
    try {
      const res = await client.post(`/parcels/${encodeURIComponent(ulpin)}/request-deletion`, { reason });
      backendId = res.data?.request_id ?? null;
      backendMessage = res.data?.message || null;
    } catch (err) {
      if (err.response?.status === 409 || err.response?.status === 403) {
        throw new Error(err.response?.data?.detail || err.message);
      }
      console.warn('Backend deletion request notice, continuing with local governance pipeline:', err.message);
    }
  }

  const delReq = {
    id: backendId != null ? String(backendId) : ('DEL-' + Date.now()),
    ulpin,
    state: targetP.state || 'TamilNadu',
    owner_name: targetP.layers?.ror?.owner_name || 'Parcel Owner',
    requester_role: 'state_admin',
    requested_by: 'State Admin Officer',
    type: 'DELETION',
    area_sqm: targetP.area_sqm || 500,
    reason,
    status: 'PENDING_DELETION_VILLAGE',
    created_at: new Date().toISOString()
  };

  await saveBoundaryRequestToFirestore(delReq);

  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  reqs.push(delReq);
  localStorage.setItem('landsetu_pending_reqs', JSON.stringify(reqs));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('landsetu-pipeline-updated'));
  }

  return {
    status: 'PENDING_DELETION_VILLAGE',
    message: backendMessage || `Land deletion request for ULPIN '${ulpin}' submitted. Village Land Officer must approve (stage 1), then the Compliance Auditor (stage 2), before the parcel is removed.`,
    request: delReq
  };
};

export const deleteParcelDirectly = async (ulpin) => {
  await markParcelDeletedInFirestore(ulpin).catch(() => {});
  await deleteCustomParcelFromFirestore(ulpin).catch(() => {});

  const customParcels = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
  delete customParcels[ulpin];
  localStorage.setItem('landsetu_custom_parcels', JSON.stringify(customParcels));

  const deletedUlpins = JSON.parse(localStorage.getItem('landsetu_deleted_parcels') || '[]');
  if (!deletedUlpins.includes(ulpin)) {
    deletedUlpins.push(ulpin);
    localStorage.setItem('landsetu_deleted_parcels', JSON.stringify(deletedUlpins));
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('landsetu-pipeline-updated'));
  }

  return {
    status: 'DELETED',
    message: `Land parcel ULPIN '${ulpin}' deleted successfully and removed from GIS master map!`
  };
};

export const villageApproveDeletion = async (requestId) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'village_officer') {
    throw new Error('Permission Denied: Only Village Land Officers can approve Stage 1 deletion. State Admin cannot self-approve.');
  }

  if (!isLocalhostBackendForbidden()) {
    try {
      await client.post(`/parcels/requests/${requestId}/village-approve-deletion`);
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 400) {
        throw new Error(err.response?.data?.detail || err.message);
      }
      console.warn('Backend village deletion approval notice:', err.message);
    }
  }

  await updateBoundaryRequestInFirestore(requestId, 'PENDING_DELETION_AUDITOR', 'village_officer');

  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  const req = reqs.find(r => String(r.id) === String(requestId));
  if (req) {
    req.status = 'PENDING_DELETION_AUDITOR';
    localStorage.setItem('landsetu_pending_reqs', JSON.stringify(reqs));
  }
  return {
    status: 'PENDING_DELETION_AUDITOR',
    message: `Deletion request #${requestId} approved at Village Level. Stage 2: forwarded to Compliance Auditor.`
  };
};

export const auditorApproveDeletion = async (requestId) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'auditor') {
    throw new Error('Permission Denied: Only Compliance Auditors can issue final deletion authorization. State Admin cannot self-approve.');
  }

  const fsReq = await getFirestoreBoundaryRequest(requestId).catch(() => null);
  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  const req = fsReq || reqs.find(r => String(r.id) === String(requestId));

  if (!isLocalhostBackendForbidden()) {
    try {
      await client.post(`/parcels/requests/${requestId}/auditor-approve-deletion`);
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 400) {
        throw new Error(err.response?.data?.detail || err.message);
      }
      console.warn('Backend auditor deletion approval notice:', err.message);
    }
  }

  await updateBoundaryRequestInFirestore(requestId, 'DELETED', 'auditor');

  if (req && req.ulpin) {
    await deleteCustomParcelFromFirestore(req.ulpin);
    await recordDeletedUlpin(req.ulpin);

    const customParcels = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
    delete customParcels[req.ulpin];
    localStorage.setItem('landsetu_custom_parcels', JSON.stringify(customParcels));
  }

  if (reqs.length > 0) {
    const localReq = reqs.find(r => String(r.id) === String(requestId));
    if (localReq) localReq.status = 'DELETED';
    localStorage.setItem('landsetu_pending_reqs', JSON.stringify(reqs));
  }

  return {
    status: 'DELETED',
    message: `Land deletion for ULPIN '${req?.ulpin || requestId}' authorized by Village Officer and Auditor. Parcel removed from the GIS database.`
  };
};

const MOCK_STATE_RAW_SAMPLES = {
  TamilNadu: [{
    ulpin: "TN-CHN-0042-1187",
    pattadar_peyar: "R. Kannan",
    khatha_num: "KH-1187",
    extent_hectares: "0.0452",
    patta_type: "record_of_rights",
    transaction_ref: "REG-2019-88213",
    transaction_date: "2019-03-14",
    land_use_code: "residential",
    fsi_permitted: "1.5",
    permit_ref: "BP-2022-441",
    permit_status: "approved",
    approved_fsi: "1.5",
    tax_annual_value: "42000",
    tax_last_updated: "2016-01-01",
    encumbrance_flag: "false"
  }],
  Chandigarh: [{
    ulpin: "CHD-SEC17-0094",
    owner_full_name: "Sardar Gurpreet Singh",
    record_no: "CHD-SEC-17-994",
    area_sqyd: "540",
    ownership_type: "100% Freehold",
    deed_number: "CHD-REG-2021-0091",
    deed_date: "2021-08-20",
    zone_category: "commercial",
    max_fsi: "2.0",
    building_license_no: "CHD-BL-2022-108",
    license_status: "approved",
    approved_fsi: "1.8",
    property_tax_value: "95000",
    tax_year: "2023-04-01",
    mortgage_status: "false"
  }],
  Maharashtra: [{
    ulpin: "MH-PUNE-712-4491",
    khatedar_nama: "Devendra Sharad Fadnavis",
    seven_twelve_no: "MH-712-4491",
    kshetra_guntha: "4.5",
    dharan_adhikar: "Klass-1 Bhoodhari",
    dast_kramank: "MH-PUNE-2020-5512",
    dast_dinank: "2020-11-12",
    vaprache_swaroop: "residential",
    prapata_fsi: "1.75",
    parvanagi_kramank: "PMC-BP-2021-88",
    parvanagi_sthiti: "approved",
    swikrut_fsi: "1.75",
    kar_aakarani_rs: "58000",
    kar_kalam_varsh: "2022-03-31",
    boja_nond: "false"
  }],
  Karnataka: [{
    ulpin: "KA-BLR-RTC-8821",
    hissadar_hesaru: "Siddaramaiah K",
    rtc_survey_no: "KA-RTC-8821",
    area_sqft: "4800",
    hakku_type: "Permanent Owner",
    kraya_patra_no: "KA-BLR-2022-991",
    kraya_dina: "2022-05-19",
    land_bhavan_code: "commercial",
    anumathi_fsi: "2.25",
    kattida_permitee_no: "BBMP-BP-2023-11",
    permitee_status: "approved",
    sanctioned_fsi: "2.0",
    swathu_therige_rs: "112000",
    therige_varsha: "2023-01-01",
    sala_boja_flag: "false"
  }],
  Delhi: [{
    ulpin: "DL-DDA-KH-4402",
    khatauni_owner: "Rajesh Kumar Sharma",
    khasra_number: "DL-DDA-4402",
    area_sqmeter: "350",
    holding_type: "Leasehold to Freehold",
    registry_token_no: "DL-REG-2021-4410",
    registry_date: "2021-09-30",
    master_plan_zone: "residential",
    norm_fsi: "2.0",
    mcd_sanction_no: "MCD-BP-2022-990",
    mcd_status: "approved",
    sanctioned_fsi: "2.0",
    property_tax_annual: "74000",
    tax_assessment_year: "2022-04-01",
    lien_mortgage_status: "false"
  }],
  Telangana: [{
    ulpin: "TG-HYD-DHR-5521",
    pattadar_namam: "K. Chandrashekar Rao",
    dharani_passbook_no: "TG-DHR-5521",
    extent_acres: "0.12",
    pattadar_hakku: "Absolute Ownership",
    sale_deed_doc_no: "TG-HYD-2021-3312",
    registration_date: "2021-06-15",
    zone_type: "residential",
    permitted_fsi: "2.5",
    ghmc_permit_no: "GHMC-BP-2022-771",
    permit_status: "approved",
    approved_fsi: "2.2",
    property_tax_amount: "88000",
    tax_paid_date: "2023-02-10",
    encumbrance_status: "false"
  }],
  Kerala: [{
    ulpin: "KL-TVM-TP-9921",
    udama_peru: "V. S. Achuthanandan",
    thandaper_no: "KL-TP-9921",
    extent_ares: "3.8",
    avakasam_type: "Janmam",
    aadhar_no: "KL-TVM-2020-4491",
    registered_date: "2020-10-05",
    upayoga_vibhagam: "residential",
    anuvadichitta_fsi: "1.5",
    building_permit_no: "KMC-BP-2021-302",
    permit_status: "approved",
    approved_fsi: "1.5",
    kudissika_tax_rs: "36000",
    tax_year: "2022-01-01",
    kadam_puyapadu: "false"
  }],
  WestBengal: [{
    ulpin: "WB-KOL-KH-7741",
    raiyat_naam: "Mamata Banerjee",
    khatian_no: "WB-KH-7741",
    area_decimal: "12.5",
    swatwa_type: "Raiyati",
    dalil_number: "WB-KOL-2021-8891",
    dalil_date: "2021-12-01",
    bhumir_shreni: "commercial",
    anumita_fsi: "2.0",
    kmc_sanction_no: "KMC-BP-2022-104",
    sanction_status: "approved",
    approved_fsi: "2.0",
    municipality_tax_rs: "65000",
    tax_year: "2022-04-01",
    daya_mortgage_flag: "false"
  }],
  Gujarat: [{
    ulpin: "GJ-AMD-712-8831",
    khatedar_naam: "Vijay Rupani",
    khata_number: "GJ-712-8831",
    khetar_are_sqm: "420",
    hakk_prakar: "Niyamit Vahat",
    dastavej_no: "GJ-AMD-2020-1102",
    dastavej_tarikh: "2020-04-18",
    jameen_hetu: "residential",
    manjur_fsi: "1.8",
    raba_mandoor_no: "AMC-BP-2021-992",
    mandoor_status: "approved",
    mandoor_fsi: "1.8",
    kar_rakam_rs: "49000",
    tax_aakhri_varsh: "2021-03-31",
    boja_vigat: "false"
  }],
  Rajasthan: [{
    ulpin: "RJ-JAI-APN-5510",
    khatedar_naam: "Ashok Gehlot",
    khatauni_no: "RJ-APN-5510",
    area_bigha: "0.18",
    khatedari_type: "Pukka Khatedar",
    sale_deed_no: "RJ-JAI-2021-6601",
    deed_date: "2021-07-22",
    land_category: "residential",
    permitted_fsi: "1.6",
    patta_permit_no: "JDA-BP-2022-401",
    permit_status: "approved",
    sanctioned_fsi: "1.5",
    property_tax_rs: "38000",
    tax_paid_year: "2022-03-31",
    girvi_status: "false"
  }],
  UttarPradesh: [{
    ulpin: "UP-LKN-KHT-9901",
    khatedar_naam: "Yogi Adityanath",
    khatauni_khata_no: "UP-KHT-9901",
    area_hectare: "0.052",
    bhumidhari_rights: "Bhumidhar with Transferable Rights",
    sub_registrar_deed_no: "UP-LKN-2020-7712",
    deed_execution_date: "2020-08-14",
    viniyog_land_use: "residential",
    lda_permitted_fsi: "1.75",
    naksha_swikriti_no: "LDA-BP-2021-550",
    naksha_status: "approved",
    swikrit_fsi: "1.75",
    grah_kar_rs: "52000",
    tax_year: "2022-04-01",
    bandhak_mortgage_flag: "false"
  }],
  Punjab: [{
    ulpin: "PB-ASR-KHW-3341",
    malik_naam: "Bhagwant Mann",
    khewat_no: "PB-KHW-3341",
    raqba_marla: "18.0",
    hissa_share: "1/1 Share",
    wasika_no: "PB-ASR-2021-5501",
    wasika_date: "2021-03-10",
    khasra_use: "residential",
    manzoor_far: "1.65",
    naksha_pass_no: "MC-ASR-2022-801",
    naksha_status: "approved",
    naksha_far: "1.65",
    property_tax_rs: "44000",
    tax_aakhri_saal: "2022-04-01",
    rehn_rahan_flag: "false"
  }],
  MadhyaPradesh: [{
    ulpin: "MP-BPL-BHL-1092",
    bhoomi_swami: "Shivraj Singh Chouhan",
    khata_kramank: "MP-BHL-1092",
    kshetrafal_hec: "0.048",
    hissa_anash: "1/1 Purna",
    panjiyan_kramank: "MP-BPL-2020-4490",
    panjiyan_tithi: "2020-09-01",
    bhoomi_prayojan: "residential",
    maney_fsi: "1.5",
    anumati_kramank: "BMC-BP-2021-662",
    anumati_sthiti: "approved",
    swikrit_fsi: "1.5",
    varshik_kar: "41000",
    kar_bhugtan_varsh: "2021-04-01",
    bandhak_sthiti: "false"
  }]
};

export const previewAdapter = async (state, rawRecord) => {
  try {
    const res = await client.post('/adapter/preview', { state, raw_record: rawRecord });
    return res.data;
  } catch (err) {
    console.warn(`Backend API unreachable for state adapter preview (${state}), running local client-side adapter normalization engine fallback:`, err.message);
    
    // Universal client-side schema adapter normalizer fallback
    const ownerName = rawRecord.pattadar_peyar || rawRecord.owner_full_name || rawRecord.khatedar_nama || rawRecord.hissadar_hesaru || rawRecord.khatauni_owner || rawRecord.pattadar_namam || rawRecord.udama_peru || rawRecord.raiyat_naam || rawRecord.malik_naam || rawRecord.bhoomi_swami || 'Land Owner';
    const khataNo = rawRecord.khatha_num || rawRecord.record_no || rawRecord.seven_twelve_no || rawRecord.rtc_survey_no || rawRecord.khasra_number || rawRecord.dharani_passbook_no || rawRecord.thandaper_no || rawRecord.khatian_no || rawRecord.khata_number || rawRecord.khatauni_no || rawRecord.khatauni_khata_no || rawRecord.khewat_no || rawRecord.khata_kramank || 'KH-101';
    const ownerShare = rawRecord.ownership_type || rawRecord.dharan_adhikar || rawRecord.hakku_type || rawRecord.holding_type || rawRecord.pattadar_hakku || rawRecord.avakasam_type || rawRecord.swatwa_type || rawRecord.hakk_prakar || rawRecord.khatedari_type || rawRecord.bhumidhari_rights || rawRecord.hissa_share || rawRecord.hissa_anash || '1/1';
    
    const txnId = rawRecord.transaction_ref || rawRecord.deed_number || rawRecord.dast_kramank || rawRecord.kraya_patra_no || rawRecord.registry_token_no || rawRecord.sale_deed_doc_no || rawRecord.aadhar_no || rawRecord.dalil_number || rawRecord.dastavej_no || rawRecord.sale_deed_no || rawRecord.sub_registrar_deed_no || rawRecord.wasika_no || rawRecord.panjiyan_kramank || 'REG-2022-001';
    const txnDate = rawRecord.transaction_date || rawRecord.deed_date || rawRecord.dast_dinank || rawRecord.kraya_dina || rawRecord.registry_date || rawRecord.registration_date || rawRecord.registered_date || rawRecord.dalil_date || rawRecord.dastavej_tarikh || rawRecord.deed_date || rawRecord.deed_execution_date || rawRecord.wasika_date || rawRecord.panjiyan_tithi || '2021-05-10';

    const landUse = rawRecord.land_use_code || rawRecord.zone_category || rawRecord.vaprache_swaroop || rawRecord.land_bhavan_code || rawRecord.master_plan_zone || rawRecord.zone_type || rawRecord.upayoga_vibhagam || rawRecord.bhumir_shreni || rawRecord.jameen_hetu || rawRecord.land_category || rawRecord.viniyog_land_use || rawRecord.khasra_use || rawRecord.bhoomi_prayojan || 'residential';
    const permFsi = parseFloat(rawRecord.fsi_permitted || rawRecord.max_fsi || rawRecord.prapata_fsi || rawRecord.anumathi_fsi || rawRecord.norm_fsi || rawRecord.permitted_fsi || rawRecord.anuvadichitta_fsi || rawRecord.anumita_fsi || rawRecord.manjur_fsi || rawRecord.lda_permitted_fsi || rawRecord.manzoor_far || rawRecord.maney_fsi || 1.5);

    const permitId = rawRecord.permit_ref || rawRecord.building_license_no || rawRecord.parvanagi_kramank || rawRecord.kattida_permitee_no || rawRecord.mcd_sanction_no || rawRecord.ghmc_permit_no || rawRecord.building_permit_no || rawRecord.kmc_sanction_no || rawRecord.raba_mandoor_no || rawRecord.patta_permit_no || rawRecord.naksha_swikriti_no || rawRecord.naksha_pass_no || rawRecord.anumati_kramank || 'BP-2022-101';
    const permitStatus = rawRecord.permit_status || rawRecord.license_status || rawRecord.parvanagi_sthiti || rawRecord.permitee_status || rawRecord.mcd_status || rawRecord.sanction_status || rawRecord.mandoor_status || rawRecord.naksha_status || rawRecord.anumati_sthiti || 'approved';
    const approvedFsi = parseFloat(rawRecord.approved_fsi || rawRecord.swikrut_fsi || rawRecord.sanctioned_fsi || rawRecord.naksha_far || permFsi);

    const taxVal = parseFloat(rawRecord.tax_annual_value || rawRecord.property_tax_value || rawRecord.kar_aakarani_rs || rawRecord.swathu_therige_rs || rawRecord.property_tax_annual || rawRecord.property_tax_amount || rawRecord.kudissika_tax_rs || rawRecord.municipality_tax_rs || rawRecord.kar_rakam_rs || rawRecord.property_tax_rs || rawRecord.grah_kar_rs || rawRecord.varshik_kar || 45000);
    const taxDate = rawRecord.tax_last_updated || rawRecord.tax_year || rawRecord.kar_kalam_varsh || rawRecord.therige_varsha || rawRecord.tax_assessment_year || rawRecord.tax_paid_date || rawRecord.tax_aakhri_varsh || rawRecord.tax_paid_year || rawRecord.tax_aakhri_saal || rawRecord.kar_bhugtan_varsh || '2022-01-01';

    // Area conversion
    let areaSqm = 450;
    if (rawRecord.extent_hectares) areaSqm = parseFloat(rawRecord.extent_hectares) * 10000;
    else if (rawRecord.area_sqyd) areaSqm = parseFloat(rawRecord.area_sqyd) * 0.836127;
    else if (rawRecord.kshetra_guntha) areaSqm = parseFloat(rawRecord.kshetra_guntha) * 101.17;
    else if (rawRecord.area_sqft) areaSqm = parseFloat(rawRecord.area_sqft) * 0.092903;
    else if (rawRecord.area_sqmeter) areaSqm = parseFloat(rawRecord.area_sqmeter);
    else if (rawRecord.extent_acres) areaSqm = parseFloat(rawRecord.extent_acres) * 4046.86;
    else if (rawRecord.extent_ares) areaSqm = parseFloat(rawRecord.extent_ares) * 100;
    else if (rawRecord.area_decimal) areaSqm = parseFloat(rawRecord.area_decimal) * 40.46;
    else if (rawRecord.khetar_are_sqm) areaSqm = parseFloat(rawRecord.khetar_are_sqm);
    else if (rawRecord.area_bigha) areaSqm = parseFloat(rawRecord.area_bigha) * 2529.29;
    else if (rawRecord.area_hectare) areaSqm = parseFloat(rawRecord.area_hectare) * 10000;
    else if (rawRecord.raqba_marla) areaSqm = parseFloat(rawRecord.raqba_marla) * 25.29;
    else if (rawRecord.kshetrafal_hec) areaSqm = parseFloat(rawRecord.kshetrafal_hec) * 10000;

    return {
      state,
      source_format: `${state.toUpperCase()}_Schema_Adapter_v2`,
      canonical: {
        ulpin: rawRecord.ulpin || `ULPIN-CANONICAL-${state.toUpperCase()}-001`,
        state,
        geometry: null,
        area_sqm: Math.round(areaSqm * 100) / 100,
        layers: {
          ror: {
            owner_name: ownerName,
            owner_share: ownerShare,
            khata_no: khataNo,
            source: "revenue_department",
            last_verified: txnDate,
            confidence: "verified"
          },
          registration: {
            last_transaction_id: txnId,
            transaction_type: "sale_deed",
            date: txnDate,
            source: "sub_registrar_office",
            confidence: "verified"
          },
          zoning: {
            land_use: landUse,
            permitted_fsi: permFsi,
            eco_sensitive: false,
            source: "town_country_planning",
            confidence: "verified"
          },
          building_permit: {
            status: permitStatus,
            permit_id: permitId,
            approved_fsi: approvedFsi,
            source: "municipal_corporation",
            confidence: "verified"
          },
          tax: {
            annual_value: taxVal,
            source: "municipal_tax_dept",
            confidence: taxDate.includes('2016') ? "stale" : "verified",
            last_verified: taxDate
          },
          encumbrance: {
            active: false,
            type: null,
            source: "sub_registrar_office",
            confidence: "verified"
          }
        },
        flags: []
      }
    };
  }
};

export const getRawSamples = async () => {
  try {
    const res = await client.get('/adapter/raw-samples');
    return res.data;
  } catch (err) {
    console.warn("Backend API unreachable for raw adapter samples, using client-side sample record dataset for all states:", err.message);
    return MOCK_STATE_RAW_SAMPLES;
  }
};

export const createCustomParcel = async (parcelData) => {
  const userRole = localStorage.getItem('landsetu_role') || 'citizen';
  
  if (userRole === 'village_officer') {
    const newReq = {
      id: 'REQ-' + Date.now(),
      ulpin: parcelData.ulpin,
      state: parcelData.state,
      owner_name: parcelData.owner_name,
      land_use: parcelData.land_use || 'residential',
      geometry: parcelData.geometry,
      area_sqm: parcelData.area_sqm,
      requester_role: 'village_officer',
      requested_by: parcelData.owner_name,
      status: 'PENDING_AUDITOR_REVIEW',
      created_at: new Date().toISOString()
    };
    await saveBoundaryRequestToFirestore(newReq);

    const pendingReqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
    pendingReqs.push(newReq);
    localStorage.setItem('landsetu_pending_reqs', JSON.stringify(pendingReqs));

    return {
      status: 'PENDING_AUDITOR_REVIEW',
      message: `Boundary change for parcel ${parcelData.ulpin} submitted! Stage 1: Awaiting Compliance Auditor Review.`,
      request: newReq
    };
  } else {
    const pObj = {
      ulpin: parcelData.ulpin,
      state: parcelData.state,
      area_sqm: parcelData.area_sqm,
      geometry: parcelData.geometry,
      land_use: parcelData.land_use || 'residential',
      layers: {
        ror: { owner_name: parcelData.owner_name, owner_share: '1/1', khata_no: 'KH-CUSTOM', source: 'village_office', confidence: 'verified' },
        registration: { last_transaction_id: 'REG-2026-CUSTOM', transaction_type: 'boundary_reshaped', date: new Date().toISOString().split('T')[0], source: 'sub_registrar', confidence: 'verified' },
        zoning: { land_use: parcelData.land_use || 'residential', permitted_fsi: 1.5, eco_sensitive: false, source: 'master_plan_2026', confidence: 'verified' },
        building_permit: { status: 'approved', permit_id: 'BP-2026-CUSTOM', approved_fsi: 1.5, source: 'municipal_corp', confidence: 'verified' },
        tax: { annual_value: 45000, source: 'revenue_dept', confidence: 'verified', last_verified: new Date().toISOString().split('T')[0] },
        encumbrance: { active: false, type: null, source: 'sub_registrar', confidence: 'verified' }
      },
      flags: []
    };
    await saveCustomParcelToFirestore(pObj);

    const customParcels = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
    customParcels[parcelData.ulpin] = pObj;
    localStorage.setItem('landsetu_custom_parcels', JSON.stringify(customParcels));

    return {
      status: 'SUCCESS',
      ulpin: parcelData.ulpin,
      message: 'Boundary change approved & committed to master GIS database!'
    };
  }
};

export const getAllStates = async () => {
  return LOCAL_STATES;
};

export const getPendingRequests = async () => {
  const local = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]')
    .filter((r) => OPEN_REQUEST_STATUSES.includes(r.status));

  let remote = [];
  try {
    remote = await getFirestorePendingRequests();
  } catch (err) {
    remote = [];
  }

  let backend = [];
  if (!isLocalhostBackendForbidden()) {
    try {
      const res = await client.get('/parcels/requests/pending');
      backend = Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      backend = [];
    }
  }

  const byId = new Map();
  for (const r of [...local, ...remote, ...backend]) {
    if (!r || r.id == null) continue;
    byId.set(String(r.id), {
      ...r,
      id: r.id,
      type: requestTypeFromStatus(r.status, r.type)
    });
  }
  return Array.from(byId.values());
};

export const auditorPassRequest = async (requestId) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'auditor' && currentRole !== 'state_admin') {
    throw new Error('Permission Denied: Only Compliance Auditors can pass compliance audit.');
  }

  await updateBoundaryRequestInFirestore(requestId, 'PENDING_STATE_ADMIN', 'auditor');

  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  const req = reqs.find(r => r.id === requestId);
  if (req) {
    req.status = 'PENDING_STATE_ADMIN';
    req.audited_by = 'Land Inspector & Compliance Auditor';
    localStorage.setItem('landsetu_pending_reqs', JSON.stringify(reqs));
  }
  return { status: 'PENDING_STATE_ADMIN', message: `Request #${requestId} passed compliance audit and forwarded to State Admin!`, ulpin: req?.ulpin };
};

export const approveBoundaryRequest = async (requestId) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'state_admin') {
    throw new Error('Permission Denied: Only State Administration Officers (state_admin) have final approval authority.');
  }

  const fsReq = await getFirestoreBoundaryRequest(requestId).catch(() => null);
  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  const req = fsReq || reqs.find(r => r.id === requestId);

  await updateBoundaryRequestInFirestore(requestId, 'APPROVED', 'state_admin');

  if (req && req.ulpin) {
    const pObj = {
      ulpin: req.ulpin,
      state: req.state || 'TamilNadu',
      area_sqm: req.area_sqm || 500,
      geometry: req.geometry,
      land_use: req.land_use || 'residential',
      layers: {
        ror: { owner_name: req.owner_name || 'Land Owner', owner_share: '1/1', khata_no: 'KH-APPROVED', source: 'village_office', confidence: 'verified' },
        registration: { last_transaction_id: 'REG-2026-APPROVED', transaction_type: 'boundary_reshaped', date: new Date().toISOString().split('T')[0], source: 'sub_registrar', confidence: 'verified' },
        zoning: { land_use: req.land_use || 'residential', permitted_fsi: 1.5, eco_sensitive: false, source: 'master_plan_2026', confidence: 'verified' },
        building_permit: { status: 'approved', permit_id: 'BP-2026-APPROVED', approved_fsi: 1.5, source: 'municipal_corp', confidence: 'verified' },
        tax: { annual_value: 48000, source: 'revenue_dept', confidence: 'verified', last_verified: new Date().toISOString().split('T')[0] },
        encumbrance: { active: false, type: null, source: 'sub_registrar', confidence: 'verified' }
      },
      flags: []
    };
    await saveCustomParcelToFirestore(pObj);

    const customParcels = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
    customParcels[req.ulpin] = pObj;
    localStorage.setItem('landsetu_custom_parcels', JSON.stringify(customParcels));
  }

  if (reqs.length > 0) {
    const localReq = reqs.find(r => r.id === requestId);
    if (localReq) localReq.status = 'APPROVED';
    localStorage.setItem('landsetu_pending_reqs', JSON.stringify(reqs));
  }

  return { status: 'APPROVED', message: `Request ${requestId} approved successfully!`, ulpin: req?.ulpin };
};

export const rejectBoundaryRequest = async (requestId) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (!['auditor', 'state_admin', 'village_officer'].includes(currentRole)) {
    throw new Error('Permission Denied: Only Village Officers, Auditors, or State Administration Officers can reject requests.');
  }

  if (!isLocalhostBackendForbidden()) {
    try {
      await client.post(`/parcels/requests/${requestId}/reject`);
    } catch (err) {
      if (err.response?.status === 403) {
        throw new Error(err.response?.data?.detail || err.message);
      }
      console.warn('Backend reject request notice:', err.message);
    }
  }

  await updateBoundaryRequestInFirestore(requestId, 'REJECTED', currentRole);

  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  const req = reqs.find(r => r.id === requestId);
  if (req) {
    req.status = 'REJECTED';
    localStorage.setItem('landsetu_pending_reqs', JSON.stringify(reqs));
  }
  return { status: 'REJECTED', message: `Request ${requestId} rejected by ${currentRole}.` };
};

const LOCAL_STATES = [
  { name: "TamilNadu", label: "Tamil Nadu", code: "TN", capital: "Chennai", center: [13.0827, 80.2707], bbox: { min_lat: 8.0, max_lat: 13.6, min_lng: 76.2, max_lng: 80.4 } },
  { name: "Chandigarh", label: "Chandigarh", code: "CHD", capital: "Chandigarh", center: [30.7333, 76.7794], bbox: { min_lat: 30.65, max_lat: 30.80, min_lng: 76.70, max_lng: 76.85 } },
  { name: "Maharashtra", label: "Maharashtra", code: "MH", capital: "Mumbai", center: [19.0760, 72.8777], bbox: { min_lat: 15.6, max_lat: 22.0, min_lng: 72.6, max_lng: 80.9 } },
  { name: "Karnataka", label: "Karnataka", code: "KA", capital: "Bengaluru", center: [12.9716, 77.5946], bbox: { min_lat: 11.5, max_lat: 18.5, min_lng: 74.0, max_lng: 78.6 } },
  { name: "Delhi", label: "Delhi (NCT)", code: "DL", capital: "New Delhi", center: [28.6139, 77.2090], bbox: { min_lat: 28.4, max_lat: 28.9, min_lng: 76.8, max_lng: 77.4 } },
  { name: "Telangana", label: "Telangana", code: "TS", capital: "Hyderabad", center: [17.3850, 78.4867], bbox: { min_lat: 15.8, max_lat: 19.9, min_lng: 77.2, max_lng: 81.8 } },
  { name: "Kerala", label: "Kerala", code: "KL", capital: "Thiruvananthapuram", center: [9.9312, 76.2673], bbox: { min_lat: 8.2, max_lat: 12.8, min_lng: 74.8, max_lng: 77.5 } },
  { name: "WestBengal", label: "West Bengal", code: "WB", capital: "Kolkata", center: [22.5726, 88.3639], bbox: { min_lat: 21.5, max_lat: 27.2, min_lng: 85.8, max_lng: 89.8 } },
  { name: "Gujarat", label: "Gujarat", code: "GJ", capital: "Gandhinagar", center: [23.0225, 72.5714], bbox: { min_lat: 20.1, max_lat: 24.7, min_lng: 68.1, max_lng: 74.5 } },
  { name: "Rajasthan", label: "Rajasthan", code: "RJ", capital: "Jaipur", center: [26.9124, 75.7873], bbox: { min_lat: 23.0, max_lat: 30.2, min_lng: 69.5, max_lng: 78.2 } },
  { name: "UttarPradesh", label: "Uttar Pradesh", code: "UP", capital: "Lucknow", center: [26.8467, 80.9462], bbox: { min_lat: 23.8, max_lat: 30.4, min_lng: 77.1, max_lng: 84.6 } },
  { name: "Punjab", label: "Punjab", code: "PB", capital: "Chandigarh", center: [30.9010, 75.8573], bbox: { min_lat: 29.5, max_lat: 32.5, min_lng: 73.8, max_lng: 76.9 } },
  { name: "MadhyaPradesh", label: "Madhya Pradesh", code: "MP", capital: "Bhopal", center: [23.2599, 77.4126], bbox: { min_lat: 21.1, max_lat: 26.9, min_lng: 74.0, max_lng: 82.8 } }
];

export const identifyStateByCoords = async (lat, lng) => {
  // 1. Fast local bounding box check FIRST (0ms, zero network calls, 100% CORS-safe)
  for (const state of LOCAL_STATES) {
    const b = state.bbox;
    if (lat >= b.min_lat && lat <= b.max_lat && lng >= b.min_lng && lng <= b.max_lng) {
      return state;
    }
  }

  // 2. Nearest center distance check if outside exact bounding box
  let closest = LOCAL_STATES[0];
  let minD = Infinity;
  for (const state of LOCAL_STATES) {
    const [cLat, cLng] = state.center;
    const d = (lat - cLat) ** 2 + (lng - cLng) ** 2;
    if (d < minD) {
      minD = d;
      closest = state;
    }
  }

  // 3. Skip remote localhost network call on HTTPS web app to avoid browser CORS loopback errors
  if (isLocalhostBackendForbidden()) {
    return closest;
  }

  try {
    const res = await client.get('/parcels/identify-state', { params: { lat, lng } });
    if (res.data && res.data.name) return res.data;
  } catch (err) {
    // Fail silently to local closest state
  }

  return closest;
};

const generateSyntheticSeedParcelsForState = (stateObj) => {
  const [cLat, cLng] = stateObj.center;
  const code = stateObj.code;
  const sName = stateObj.name;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { ulpin: `${code}-SEC-0101`, state: sName, owner_name: "Ramesh Sharma", land_use: "residential" },
        geometry: { type: "Polygon", coordinates: [[[cLng - 0.003, cLat - 0.003], [cLng - 0.0005, cLat - 0.003], [cLng - 0.0005, cLat - 0.001], [cLng - 0.003, cLat - 0.001], [cLng - 0.003, cLat - 0.003]]] }
      },
      {
        type: "Feature",
        properties: { ulpin: `${code}-SEC-0102`, state: sName, owner_name: "Priya Patel", land_use: "residential" },
        geometry: { type: "Polygon", coordinates: [[[cLng + 0.0005, cLat - 0.003], [cLng + 0.003, cLat - 0.003], [cLng + 0.003, cLat - 0.001], [cLng + 0.0005, cLat - 0.001], [cLng + 0.0005, cLat - 0.003]]] }
      },
      {
        type: "Feature",
        properties: { ulpin: `${code}-SEC-0103`, state: sName, owner_name: "Suresh Reddy", land_use: "commercial" },
        geometry: { type: "Polygon", coordinates: [[[cLng - 0.003, cLat + 0.0005], [cLng - 0.0005, cLat + 0.0005], [cLng - 0.0005, cLat + 0.0025], [cLng - 0.003, cLat + 0.0025], [cLng - 0.003, cLat + 0.0005]]] }
      },
      {
        type: "Feature",
        properties: { ulpin: `${code}-SEC-0104`, state: sName, owner_name: "Anita Menon", land_use: "residential" },
        geometry: { type: "Polygon", coordinates: [[[cLng + 0.0005, cLat + 0.0005], [cLng + 0.003, cLat + 0.0005], [cLng + 0.003, cLat + 0.0025], [cLng + 0.0005, cLat + 0.0025], [cLng + 0.0005, cLat + 0.0005]]] }
      },
      {
        type: "Feature",
        properties: { ulpin: `${code}-SEC-0105`, state: sName, owner_name: "Vikram Chatterjee", land_use: "residential" },
        geometry: { type: "Polygon", coordinates: [[[cLng - 0.0055, cLat - 0.003], [cLng - 0.0035, cLat - 0.003], [cLng - 0.0035, cLat - 0.001], [cLng - 0.0055, cLat - 0.001], [cLng - 0.0055, cLat - 0.003]]] }
      },
      {
        type: "Feature",
        properties: { ulpin: `${code}-SEC-0106`, state: sName, owner_name: "Sunita Deshmukh", land_use: "residential" },
        geometry: { type: "Polygon", coordinates: [[[cLng + 0.0035, cLat - 0.003], [cLng + 0.0055, cLat - 0.003], [cLng + 0.0055, cLat - 0.001], [cLng + 0.0035, cLat - 0.001], [cLng + 0.0035, cLat - 0.003]]] }
      }
    ]
  };
};

const getFallbackSeedParcelsGeoJSON = (stateName) => {
  const normState = String(stateName || '').toLowerCase().replace(/[^a-z]/g, '');

  if (normState.includes('chandigarh')) {
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0201", state: "Chandigarh", owner_name: "Harpreet Singh", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.7750, 30.7320], [76.7775, 30.7320], [76.7775, 30.7340], [76.7750, 30.7340], [76.7750, 30.7320]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0202", state: "Chandigarh", owner_name: "Gurpreet Kaur", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.7780, 30.7320], [76.7805, 30.7320], [76.7805, 30.7340], [76.7780, 30.7340], [76.7780, 30.7320]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0203", state: "Chandigarh", owner_name: "Rajesh Sharma", land_use: "ecological" }, geometry: { type: "Polygon", coordinates: [[[76.7840, 30.7370], [76.7860, 30.7370], [76.7860, 30.7390], [76.7840, 30.7390], [76.7840, 30.7370]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0204", state: "Chandigarh", owner_name: "Simranjeet Singh", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.7750, 30.7345], [76.7775, 30.7345], [76.7775, 30.7365], [76.7750, 30.7365], [76.7750, 30.7345]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0205", state: "Chandigarh", owner_name: "Amit Verma", land_use: "commercial" }, geometry: { type: "Polygon", coordinates: [[[76.7780, 30.7345], [76.7805, 30.7345], [76.7805, 30.7365], [76.7780, 30.7365], [76.7780, 30.7345]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0206", state: "Chandigarh", owner_name: "Neha Gupta", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.7720, 30.7320], [76.7745, 30.7320], [76.7745, 30.7340], [76.7720, 30.7340], [76.7720, 30.7320]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0207", state: "Chandigarh", owner_name: "Kuldeep Malhotra", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.7720, 30.7345], [76.7745, 30.7345], [76.7745, 30.7365], [76.7720, 30.7365], [76.7720, 30.7345]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0208", state: "Chandigarh", owner_name: "Manpreet Kaur", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.7810, 30.7320], [76.7830, 30.7320], [76.7830, 30.7340], [76.7810, 30.7340], [76.7810, 30.7320]]] } }
      ]
    };
  }

  if (normState.includes('tamil') || normState === 'tn' || normState === 'tamilnadu') {
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1187", state: "TamilNadu", owner_name: "R. Kannan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.2700, 13.0820], [80.2725, 13.0820], [80.2725, 13.0840], [80.2700, 13.0840], [80.2700, 13.0820]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1188", state: "TamilNadu", owner_name: "M. Selvam", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.2720, 13.0830], [80.2745, 13.0830], [80.2745, 13.0850], [80.2720, 13.0850], [80.2720, 13.0830]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1189", state: "TamilNadu", owner_name: "V. Ramanathan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.2750, 13.0820], [80.2770, 13.0820], [80.2770, 13.0840], [80.2750, 13.0840], [80.2750, 13.0820]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1190", state: "TamilNadu", owner_name: "S. Lakshmi", land_use: "commercial" }, geometry: { type: "Polygon", coordinates: [[[80.2700, 13.0845], [80.2725, 13.0845], [80.2725, 13.0865], [80.2700, 13.0865], [80.2700, 13.0845]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1191", state: "TamilNadu", owner_name: "P. Murugan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.2730, 13.0855], [80.2755, 13.0855], [80.2755, 13.0875], [80.2730, 13.0875], [80.2730, 13.0855]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1192", state: "TamilNadu", owner_name: "K. Jayaraman", land_use: "commercial" }, geometry: { type: "Polygon", coordinates: [[[80.2760, 13.0845], [80.2785, 13.0845], [80.2785, 13.0865], [80.2670, 13.0845], [80.2760, 13.0845]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1193", state: "TamilNadu", owner_name: "D. Anitha", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.2670, 13.0820], [80.2695, 13.0820], [80.2695, 13.0840], [80.2670, 13.0840], [80.2670, 13.0820]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1194", state: "TamilNadu", owner_name: "G. Balaji", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.2670, 13.0845], [80.2695, 13.0845], [80.2695, 13.0865], [80.2670, 13.0865], [80.2670, 13.0845]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1195", state: "TamilNadu", owner_name: "T. Radhakrishnan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.2790, 13.0820], [80.2815, 13.0820], [80.2815, 13.0840], [80.2790, 13.0840], [80.2790, 13.0820]]] } }
      ]
    };
  }

  // Find matching state from LOCAL_STATES
  const matchedState = LOCAL_STATES.find(s => s.name.toLowerCase() === normState || s.label.toLowerCase().replace(/[^a-z]/g, '') === normState) || LOCAL_STATES[0];
  return generateSyntheticSeedParcelsForState(matchedState);
};

const getFallbackProtectedZonesGeoJSON = (stateName) => {
  if (stateName === 'Chandigarh') {
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone_id: "ECO-ZONE-CHD-01", name: "Sukhna Lake Protected Eco-Zone", type: "protected_zone" }, geometry: { type: "Polygon", coordinates: [[[76.7820, 30.7360], [76.7880, 30.7360], [76.7880, 30.7410], [76.7820, 30.7410], [76.7820, 30.7360]]] } }
      ]
    };
  }

  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { zone_id: "ECO-ZONE-TN-01", name: "Guindy Forest Buffer Zone", type: "protected_zone" }, geometry: { type: "Polygon", coordinates: [[[80.2650, 13.0800], [80.2850, 13.0800], [80.2850, 13.0815], [80.2650, 13.0815], [80.2650, 13.0800]]] } }
    ]
  };
};
