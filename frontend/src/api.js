import axios from 'axios';
import { auth } from './firebase';
import { KNOWN_ROLES } from './roles';

// Confidence for values this browser made up or copied from bundled samples. Only the records service,
// importing from a department's own record, may label a value 'verified'.
export const UNVERIFIED_PLACEHOLDER = 'unverified_placeholder';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' && window.location.protocol === 'https:' ? '/api' : 'http://localhost:8000');

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Firebase Hosting rewrites unknown paths, including /api/*, to index.html with status 200.
// Treat an HTML reply to an API call as "no backend" so every caller takes its offline path.
client.interceptors.response.use((res) => {
  const type = String(res.headers?.['content-type'] || '');
  if (type.includes('text/html')) {
    return Promise.reject(new Error('API unavailable: received a web page instead of data'));
  }
  return res;
});

const isLocalhostBackendForbidden = () => {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' && API_BASE_URL.includes('localhost');
};

// The fallback is expected whenever no backend is hosted. Say so once, not on every map load.
const warned = new Set();
const noticeOnce = (message) => {
  if (warned.has(message)) return;
  warned.add(message);
  console.info(message);
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
    return { isBackendConnected: false, mode: 'OFFLINE_DEMO', label: 'Offline mode (local backend unreachable from HTTPS)' };
  }
  try {
    const res = await client.get('/parcels/states/all', { timeout: 2000 });
    if (res.data) {
      return { isBackendConnected: true, mode: 'PRIMARY_SYNC', label: 'Live records service' };
    }
  } catch (err) {}
  return { isBackendConnected: false, mode: 'OFFLINE_DEMO', label: 'Offline copy' };
};

export const mockLogin = async (role) => {
  const res = await client.post('/auth/mock-login', { role });
  return res.data;
};

// The site and the API are on different domains. Browsers such as Safari block cross-site cookies,
// so the session token is also sent as a Bearer header. It is kept in memory only.
let sessionToken = null;

export const firebaseLogin = async (idToken) => {
  const res = await client.post('/auth/firebase-login', { id_token: idToken });
  sessionToken = res.data?.token || null;
  return res.data;
};

client.interceptors.request.use((config) => {
  if (sessionToken) config.headers.Authorization = `Bearer ${sessionToken}`;
  return config;
});

// The access token lasts 30 minutes. On a 401, sign in to the API again once and retry.
client.interceptors.response.use((res) => res, async (err) => {
  const cfg = err.config;
  const isAuthCall = String(cfg?.url || '').startsWith('/auth/');
  if (err.response?.status === 401 && cfg && !cfg._retried && !isAuthCall && auth?.currentUser) {
    cfg._retried = true;
    try {
      await firebaseLogin(await auth.currentUser.getIdToken(true));
      return client.request(cfg);
    } catch (e) { /* fall through to the original error */ }
  }
  return Promise.reject(err);
});

// The free host sleeps when idle. Ask it to wake as soon as the site opens.
export const wakeBackend = () => {
  if (isLocalhostBackendForbidden()) return;
  client.get('/health', { timeout: 65000 }).catch(() => {});
};



// Role for display. The server session is the source of truth. If the records service is not
// reachable, fall back to the role claim on the signed-in account. The server still enforces
// every action, so this only decides what the interface shows.
// The last check is kept so the account menu can show where the role came from.
let roleDiagnostic = { source: 'none', server: null, claim: null };
export const getRoleDiagnostic = () => roleDiagnostic;

// Resolved once per signed-in account per session: onAuthStateChanged fires on every token refresh, and each
// resolution costs a session exchange with the records service.
const roleCache = new Map();   // uid -> Promise<role>

export const resolveRole = (user) => {
  if (!user) return Promise.resolve('citizen');
  if (!roleCache.has(user.uid)) roleCache.set(user.uid, resolveRoleOnce(user));
  return roleCache.get(user.uid);
};

export const forgetRole = () => roleCache.clear();

const resolveRoleOnce = async (user) => {
  const diag = { source: 'default (no role found)', server: null, claim: null };
  let role = 'citizen';
  try {
    const session = await firebaseLogin(await user.getIdToken(true));
    diag.server = session?.role ?? null;
    if (session && KNOWN_ROLES.includes(session.role)) { role = session.role; diag.source = 'records service session'; }
  } catch (err) {
    diag.server = `unavailable (${err.response?.status || err.message})`;
  }
  if (diag.source.startsWith('default')) {
    try {
      const claims = (await user.getIdTokenResult(true)).claims;
      diag.claim = claims.role ?? 'not set';
      if (KNOWN_ROLES.includes(claims.role)) { role = claims.role; diag.source = 'account role claim'; }
    } catch (err) {
      diag.claim = `unreadable (${err.message})`;
    }
  }
  roleDiagnostic = diag;
  return role;
};

export const logout = async () => {
  return client.post('/auth/logout');
};

export const listParcels = async (state) => {
  const params = state ? { state } : {};
  const res = await client.get('/parcels', { params });
  return res.data;
};

// The records service is the only source of parcel data. There is no browser copy, no Firestore copy and no
// bundled or generated sample: a state with no records shows no parcels, and an unreachable service is an error
// the map shows as such.
export class ParcelNotFoundError extends Error {
  constructor(ulpin) {
    super(`Parcel ${ulpin} is not in the land records service.`);
    this.name = 'ParcelNotFoundError';
    this.ulpin = ulpin;
  }
}

export const getParcelsGeoJSON = async (state) => {
  const res = await client.get('/parcels/geojson/all', { params: state ? { state } : {} }).catch((err) => {
    throw restError(err, 'Loading parcels');
  });
  return { type: 'FeatureCollection', features: Array.isArray(res.data?.features) ? res.data.features : [] };
};

export const getProtectedZonesGeoJSON = async (state) => {
  const res = await client.get('/parcels/protected-zones/geojson', { params: state ? { state } : {} }).catch((err) => {
    throw restError(err, 'Loading protected zones');
  });
  return { type: 'FeatureCollection', features: Array.isArray(res.data?.features) ? res.data.features : [] };
};

// One request. A 404 means the records service holds no such parcel: ParcelNotFoundError, and callers must not
// go on to request its intelligence, audit chain or passport.
// Identical requests already in flight share one network call (a component mounting twice, two panels asking at
// once). Settled results are not cached, so the next open always reads the current record.
const inflight = new Map();
const once = (key, fn) => {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
};

export const getParcelDetail = (ulpin) => once(`detail:${ulpin}`, async () => {
  try {
    const res = await client.get(`/parcels/${encodeURIComponent(ulpin)}`);
    return res.data;
  } catch (err) {
    if (err.response?.status === 404) throw new ParcelNotFoundError(ulpin);
    throw restError(err, 'Loading the parcel record');
  }
});

export const getParcelFlags = async (ulpin) => {
  try {
    const res = await client.get(`/parcels/${ulpin}/flags`);
    return res.data;
  } catch (err) {
    return [];
  }
};

// The tamper-evident audit log kept by the records service. null when the service is unreachable.
export const getAuditChain = async (ulpin) => {
  if (isLocalhostBackendForbidden()) return null;
  try {
    const res = await client.get(`/parcels/${encodeURIComponent(ulpin)}/audit-chain`);
    return Array.isArray(res.data?.entries) ? res.data : null;
  } catch (err) {
    return null;
  }
};

// Single-approver track for spelling-level corrections.
// The records service's audit log: filters { ulpin, event, actor_role, date_from, date_to, offset, limit }.
export const getAuditLog = (filters = {}) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null)).toString();
  return restCall('get', `/parcels/audit-log?${q}`, 'Loading the audit log');
};

// Requests filed by the signed-in account, newest first: { total, offset, limit, items }.
export const getMyRequests = (offset = 0, limit = 20) =>
  restCall('get', `/parcels/requests/mine?offset=${offset}&limit=${limit}`, 'Loading your requests');

export const fastApproveRequest = (requestId) => restPost(`/parcels/requests/${requestId}/fast-approve`, 'Fast-track approval');

// The passport and its ledger reference come only from the records service: the block hash is the head of the
// server's audit log (hashes recomputed on every read). Nothing here is assembled or signed in the browser.
export const getParcelPassport = async (ulpin) => {
  const audit = await getAuditChain(ulpin);
  const res = await client.get(`/parcels/${ulpin}/passport`).catch((err) => {
    throw restError(err, 'Issuing a parcel passport');
  });
  return {
    ...res.data,
    block_hash: audit ? `0x${audit.head_hash}` : null,
    block_height: audit ? audit.entries.length : null,
    ledger_verified: audit ? audit.verified === true : null,
  };
};

const restError = (err, action) => {
  if (err.response) return new Error(err.response.data?.detail || `${action} failed (${err.response.status}).`);
  return new Error(`${action} needs the live LandSetu API, which is not reachable right now.`);
};

const restCall = async (method, url, action, data) => {
  if (isLocalhostBackendForbidden()) throw restError({}, action);
  try {
    const res = await client.request({ method, url, data });
    return res.data;
  } catch (err) {
    throw restError(err, action);
  }
};
const restPost = (url, action, data) => restCall('post', url, action, data);

// Archival (deletion) requests go through the records service like every other request.
export const requestParcelDeletion = async (ulpin, reason = 'State Admin requested parcel archival') => {
  const res = await restPost(`/parcels/${encodeURIComponent(ulpin)}/request-deletion`, 'Filing the archival request', { reason });
  return { status: res.status, message: res.message || `Archival request for ULPIN '${ulpin}' filed. The village land officer reviews it first, then the auditor.`, request_id: res.request_id };
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
            confidence: UNVERIFIED_PLACEHOLDER
          },
          registration: {
            last_transaction_id: txnId,
            transaction_type: "sale_deed",
            date: txnDate,
            source: "sub_registrar_office",
            confidence: UNVERIFIED_PLACEHOLDER
          },
          zoning: {
            land_use: landUse,
            permitted_fsi: permFsi,
            eco_sensitive: false,
            source: "town_country_planning",
            confidence: UNVERIFIED_PLACEHOLDER
          },
          building_permit: {
            status: permitStatus,
            permit_id: permitId,
            approved_fsi: approvedFsi,
            source: "municipal_corporation",
            confidence: UNVERIFIED_PLACEHOLDER
          },
          tax: {
            annual_value: taxVal,
            source: "municipal_tax_dept",
            confidence: UNVERIFIED_PLACEHOLDER,
            last_verified: taxDate
          },
          encumbrance: {
            active: false,
            type: null,
            source: "sub_registrar_office",
            confidence: UNVERIFIED_PLACEHOLDER
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

// A boundary marking is always a request decided by the records service, for every role. There is no offline
// path: an approval step that ran only in this browser would skip every review rule.
// The service computes the parcel's area and state from the geometry. The browser's area estimate is still
// sent because API versions before 05bc7b3 require the field; current versions ignore it. State is not sent,
// so every API version detects it on the server.
export const createCustomParcel = (parcelData) =>
  restPost('/parcels/custom', 'Filing a boundary request', {
    ulpin: parcelData.ulpin,
    owner_name: parcelData.owner_name,
    geometry: parcelData.geometry,
    area_sqm: parcelData.area_estimate_sqm,
  });

export const getAllStates = async () => {
  return LOCAL_STATES;
};

// Open requests; `limit` pages the records service's list. The returned array carries `.total`.
// Open requests from the records service; `limit` pages the list. The returned array carries `.total`.
export const getPendingRequests = async (limit = 50) => {
  const res = await client.get('/parcels/requests/pending', { params: { limit } }).catch((err) => {
    throw restError(err, 'Loading the approval queue');
  });
  const items = Array.isArray(res.data) ? res.data : [];
  items.total = Number(res.headers?.['x-total-count']) || items.length;
  return items;
};

export const auditorPassRequest = (requestId) => restPost(`/parcels/requests/${requestId}/auditor-pass`, 'Auditor review');

// `record` is required when approval creates a new parcel (request.needs_record_entry): the approving officer's
// entry of owner, zoning, tax_value and encumbrance_status, stored as officer_provided.
export const approveBoundaryRequest = (requestId, request = null, record = null) =>
  restPost(`/parcels/requests/${requestId}/approve`, 'Final approval', record || undefined);

// Rejecting needs remarks (at least 5 characters). The requester sees them with the request's status.
export const rejectBoundaryRequest = (requestId, request = null, remarks = '') =>
  restPost(`/parcels/requests/${requestId}/reject`, 'Rejection', { remarks });

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

export const villagePassRequest = (requestId) =>
  restPost(`/parcels/requests/${requestId}/village-pass`, 'Village verification');

export const requestSplit = (ulpin, partGeometries, reason, requestedBy) =>
  restPost(`/parcels/${encodeURIComponent(ulpin)}/split-request`, 'Split request', {
    parts: partGeometries.map((geometry) => ({ geometry })),
    reason,
    requested_by: requestedBy || 'Village Land Officer',
  });

export const requestMerge = (ulpin, mergeWith, reason, requestedBy) =>
  restPost(`/parcels/${encodeURIComponent(ulpin)}/merge-request`, 'Merge request', {
    merge_with: mergeWith,
    reason,
    requested_by: requestedBy || 'Village Land Officer',
  });

export const requestCorrection = (ulpin, { layer, field, requestedValue, evidence, requestedBy, referencesRequestId }) =>
  restPost(`/parcels/${encodeURIComponent(ulpin)}/correction-request`, 'Correction request', {
    layer, field, requested_value: requestedValue, evidence, requested_by: requestedBy,
    references_request_id: referencesRequestId || undefined,
  });

export const getAnalyticsSummary = () => restCall('get', '/parcels/analytics/summary', 'Analytics');

// Offline history: only the department layers are available, no request trail.
export const getParcelHistory = (ulpin) => once(`history:${ulpin}`, async () => {
  const data = await restCall('get', `/parcels/${encodeURIComponent(ulpin)}/history`, 'Loading the parcel history');
  return { events: Array.isArray(data?.events) ? data.events : [], source: 'live' };
});

// One page of search results from the records service: { items, total }.
export const searchParcelsPage = async (q, offset = 0, limit = 20) => {
  const res = await client.get('/parcels/search', { params: { q: String(q || '').trim(), offset, limit } });
  return { items: Array.isArray(res.data) ? res.data : [], total: Number(res.headers?.['x-total-count']) || 0 };
};

export const searchParcels = async (q, state) => {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const data = await restCall('get', `/parcels/search?${new URLSearchParams({ q: term, ...(state ? { state } : {}) })}`, 'Searching parcels');
  return Array.isArray(data) ? data : [];
};

const adminCall = async (method, url, data) => {
  try {
    const res = await client.request({ method, url, data });
    return res.data;
  } catch (err) {
    const detail = err.response?.data?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Account management needs the live LandSetu API, which is not reachable right now.');
  }
};
export const listAccounts = () => adminCall('get', '/admin/users');
export const createAccount = (email, displayName, role) => adminCall('post', '/admin/users', { email, display_name: displayName || null, role });
export const setAccountRole = (uid, role) => adminCall('put', `/admin/users/${encodeURIComponent(uid)}/role`, { role });
export const setAccountDisabled = (uid, disabled) => adminCall('put', `/admin/users/${encodeURIComponent(uid)}/disabled`, { disabled });
export const listRoleAudit = () => adminCall('get', '/admin/audit');

// Archival and concern actions. All are decided by the records service.
export const villageApproveArchival = (id) => restPost(`/parcels/requests/${id}/village-approve-deletion`, 'Village approval');
export const auditorApproveArchival = (id) => restPost(`/parcels/requests/${id}/auditor-approve-deletion`, 'Archival authorization');
export const withdrawRequest = (id) => restPost(`/parcels/requests/${id}/withdraw`, 'Withdrawal');
export const raiseConcern = (id, reason) => restPost(`/parcels/requests/${id}/flags`, 'Raising a concern', { reason });
export const acknowledgeConcern = (flagId) => restPost(`/parcels/flags/${flagId}/acknowledge`, 'Acknowledging a concern');
export const resolveConcern = (flagId, note) => restPost(`/parcels/flags/${flagId}/resolve`, 'Resolving a concern', { note });

// Statistical signals (officers only) and their state-wide summary (state admin).
export const getParcelIntelligence = (ulpin) => once(`intel:${ulpin}`, () => restCall('get', `/parcels/${encodeURIComponent(ulpin)}/intelligence`, 'Statistical signals'));
export const getIntelligenceSummary = () => restCall('get', '/parcels/analytics/intelligence', 'Statistical summary');

// Cross-department land transactions (Registration, Revenue, Estate Office, Municipal, Planning, Dispute).
export const getParcelTransactions = (ulpin) => restCall('get', `/parcels/${encodeURIComponent(ulpin)}/transactions`, 'Loading transactions');
export const getTransaction = (id) => restCall('get', `/transactions/${id}`, 'Loading the transaction');
export const openTransaction = (body) => restPost('/transactions', 'Opening the transaction', body);
export const actOnTransactionStage = (id, action, remarks = '') => restCall('patch', `/transactions/${id}/stage`, 'Recording the stage decision', { action, remarks });
export const handoffTransaction = (id, toDepartment, reason) => restPost(`/transactions/${id}/handoff`, 'Handing the transaction off', { to_department: toDepartment, reason });
