import axios from 'axios';
import {
  saveBoundaryRequestToFirestore,
  updateBoundaryRequestInFirestore,
  getFirestorePendingRequests,
  getFirestoreCustomParcels,
  getFirestoreBoundaryRequest,
  markParcelDeletedInFirestore,
  getFirestoreDeletedUlpins
} from './firebaseFirestore';
import { auth } from './firebase';
import { notifySyncIssue } from './syncNotice';

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

const KNOWN_ROLES = ['citizen', 'village_officer', 'auditor', 'state_admin', 'super_admin'];

// Role for display. The server session is the source of truth. If the records service is not
// reachable, fall back to the role claim on the signed-in account. The server still enforces
// every action, so this only decides what the interface shows.
// The last check is kept so the account menu can show where the role came from.
let roleDiagnostic = { source: 'none', server: null, claim: null };
export const getRoleDiagnostic = () => roleDiagnostic;

export const resolveRole = async (user) => {
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
  console.info('LandSetu role check', { email: user?.email, role, ...diag });
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

// The records service is the only source of parcels on the map. Its answer is used even when it is empty: a
// state with no records shows no parcels, rather than parcels made up in this browser. The bundled sample is
// used only when the service cannot be reached, and is marked `source: 'offline_sample'`.
// Parcels and deletion markers written by browsers to Firestore or localStorage before the rules were locked
// (see docs/security-posture.md, C4) are not applied: the service already leaves archived parcels out.
export const getParcelsGeoJSON = async (state) => {
  if (!isLocalhostBackendForbidden()) {
    const params = state ? { state } : {};
    try {
      const res = await client.get('/parcels/geojson/all', { params });
      if (res.data && Array.isArray(res.data.features)) {
        return { ...res.data, source: 'service' };
      }
    } catch (err) {
      noticeOnce('LandSetu: records service not reachable, showing the bundled sample parcels.');
    }
  }
  return { ...getFallbackSeedParcelsGeoJSON(state || 'TamilNadu'), source: 'offline_sample' };
};

export const getProtectedZonesGeoJSON = async (state) => {
  if (!isLocalhostBackendForbidden()) {
    const params = state ? { state } : {};
    try {
      const res = await client.get('/parcels/protected-zones/geojson', { params });
      // The service's answer stands even when empty; no zone is made up for a state it holds none for.
      if (res.data && Array.isArray(res.data.features)) {
        return res.data;
      }
    } catch (err) {
      noticeOnce('LandSetu: records service not reachable, showing the bundled sample parcels.');
    }
  }
  return getFallbackProtectedZonesGeoJSON(state || 'TamilNadu');
};

// Browser-written parcel copies are no longer shown: none of them went through the records service, and
// the rules now refuse new ones. The local cache of them is cleared.
export const getApprovedCustomParcels = async () => {
  try { localStorage.removeItem('landsetu_custom_parcels'); } catch (e) { /* storage unavailable */ }
  return {};
};

// From the records service. A parcel the service does not hold is reported as not found; the bundled sample
// record is shown only when the service cannot be reached.
export const getParcelDetail = async (ulpin) => {
  if (!isLocalhostBackendForbidden()) {
    try {
      const res = await client.get(`/parcels/${encodeURIComponent(ulpin)}`);
      return res.data;
    } catch (err) {
      if (err.response?.status === 404) {
        throw new Error(`Parcel ${ulpin} is not in the land records service.`);
      }
      if (err.response) throw restError(err, 'Loading the parcel record');
      // No response: the service is unreachable, so fall back to the bundled sample below.
    }
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
        ror: { owner_name: seedFeature.properties.owner_name, owner_share: '1/1', khata_no: 'KH-1187', source: 'registration_dept', last_verified: '2023-03-14', confidence: UNVERIFIED_PLACEHOLDER },
        registration: { last_transaction_id: 'REG-2023-88213', transaction_type: 'sale', date: '2023-03-14', source: 'sub_registrar', confidence: UNVERIFIED_PLACEHOLDER },
        zoning: { land_use: seedFeature.properties.land_use || 'residential', permitted_fsi: 1.5, eco_sensitive: false, source: 'master_plan_2023', confidence: UNVERIFIED_PLACEHOLDER },
        building_permit: { status: 'approved', permit_id: 'BP-2023-441', approved_fsi: 1.5, source: 'municipal_corp', confidence: UNVERIFIED_PLACEHOLDER },
        tax: { annual_value: 42000, source: 'revenue_dept', confidence: UNVERIFIED_PLACEHOLDER, last_verified: '2023-01-01' },
        encumbrance: { active: false, type: null, source: 'sub_registrar', confidence: UNVERIFIED_PLACEHOLDER }
      },
      flags: [],
      offline_sample: true
    };
  }

  // Synthetic seed parcels for the other states: find the one this ULPIN belongs to.
  let synth = null;
  let synthState = null;
  for (const st of LOCAL_STATES) {
    const hit = generateSyntheticSeedParcelsForState(st).features.find((f) => f.properties.ulpin === ulpin);
    if (hit) { synth = hit; synthState = st; break; }
  }
  const prefix = String(ulpin).split('-')[0];
  const stateName = synthState?.name || LOCAL_STATES.find((st) => st.code === prefix)?.name || 'TamilNadu';

  return {
    ulpin,
    state: stateName,
    geometry: synth?.geometry || null,
    area_sqm: 500,
    layers: {
      ror: { owner_name: synth?.properties.owner_name || 'Land Owner', owner_share: '1/1', khata_no: 'KH-712', source: 'revenue_dept', last_verified: '2024-01-01', confidence: UNVERIFIED_PLACEHOLDER },
      registration: { last_transaction_id: 'REG-2024-001', transaction_type: 'sale', date: '2024-01-01', source: 'sub_registrar', confidence: UNVERIFIED_PLACEHOLDER },
      zoning: { land_use: synth?.properties.land_use || 'residential', permitted_fsi: 1.5, eco_sensitive: false, source: 'master_plan', confidence: UNVERIFIED_PLACEHOLDER },
      building_permit: { status: 'approved', permit_id: 'BP-2024-101', approved_fsi: 1.5, source: 'municipal_corp', confidence: UNVERIFIED_PLACEHOLDER },
      tax: { annual_value: 48000, source: 'revenue_dept', confidence: UNVERIFIED_PLACEHOLDER, last_verified: '2024-01-01' },
      encumbrance: { active: false, type: null, source: 'sub_registrar', confidence: UNVERIFIED_PLACEHOLDER }
    },
    flags: [],
    offline_sample: true
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

// Split, merge and correction requests exist only in the backend database. The Firestore
// and localStorage fallbacks cannot apply them, so they never go through those paths.
export const REST_ONLY_REQUEST_TYPES = ['SPLIT', 'MERGE', 'CORRECTION'];
// Requests that came from the records service carry `permissions`; those are always decided there.
const isRestOnlyRequest = (req) => !!req && (REST_ONLY_REQUEST_TYPES.includes(req.type) || !!req.permissions);

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

const OPEN_REQUEST_STATUSES = ['PENDING_VILLAGE_REVIEW', 'PENDING_AUDITOR_REVIEW', 'PENDING_STATE_ADMIN', 'PENDING_APPROVAL', 'PENDING', 'PENDING_DELETION_VILLAGE', 'PENDING_DELETION_AUDITOR', 'PENDING_FAST_REVIEW'];
const DELETED_ULPINS_KEY = 'landsetu_deleted_ulpins';

const requestTypeFromStatus = (status, fallbackType) => {
  if (fallbackType) return fallbackType;
  return String(status || '').includes('DELETION') ? 'DELETION' : 'BOUNDARY';
};

// Write to the shared Firestore copy of the approval queue. When the records service already accepted the
// action (`accepted`), a failed write does not undo it: the user is told the shared copy was not updated.
// When the shared copy is the only record of the action, a failed write means the action did not happen,
// so it is thrown for the caller to show.
const writeSharedCopy = async (write, action, accepted) => {
  try {
    await write();
  } catch (err) {
    if (!accepted) throw new Error(`${action} did not go through. ${err.message}`);
    notifySyncIssue(action, err.message);
  }
};

export const recordDeletedUlpin = async (ulpin, requestId, accepted = false) => {
  if (!ulpin) return;
  await writeSharedCopy(() => markParcelDeletedInFirestore(ulpin, requestId), 'Recording the deletion', accepted);
  const local = JSON.parse(localStorage.getItem(DELETED_ULPINS_KEY) || '[]');
  if (!local.includes(ulpin)) {
    local.push(ulpin);
    localStorage.setItem(DELETED_ULPINS_KEY, JSON.stringify(local));
  }
};

export const getDeletedUlpins = async () => {
  const local = JSON.parse(localStorage.getItem(DELETED_ULPINS_KEY) || '[]');
  const remote = await getFirestoreDeletedUlpins();
  return [...new Set([...local, ...remote])];
};

export const requestParcelDeletion = async (ulpin, reason = "State Admin requested parcel deletion") => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'state_admin' && currentRole !== 'super_admin') {
    throw new Error('Permission Denied: Only State Administration Officers (state_admin) can request land parcel deletion.');
  }

  const pending = await getPendingRequests();
  const alreadyOpen = pending.find((r) => r.ulpin === ulpin && String(r.status || '').includes('DELETION'));
  if (alreadyOpen) {
    throw new Error(`A deletion request for ULPIN '${ulpin}' is already pending (${alreadyOpen.status}).`);
  }

  const targetP = await getParcelDetail(ulpin).catch(() => ({})) || {};

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

  await writeSharedCopy(() => saveBoundaryRequestToFirestore(delReq), 'Filing the deletion request', backendId != null);

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

export const villageApproveDeletion = async (requestId) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'village_officer' && currentRole !== 'super_admin') {
    throw new Error('Permission Denied: Only Village Land Officers can approve Stage 1 deletion. State Admin cannot self-approve.');
  }

  let accepted = false;
  if (!isLocalhostBackendForbidden()) {
    try {
      await client.post(`/parcels/requests/${requestId}/village-approve-deletion`);
      accepted = true;
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 400) {
        throw new Error(err.response?.data?.detail || err.message);
      }
      console.warn('Backend village deletion approval notice:', err.message);
    }
  }

  await writeSharedCopy(() => updateBoundaryRequestInFirestore(requestId, 'PENDING_DELETION_AUDITOR', currentRole), 'Village approval', accepted);

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
  if (currentRole !== 'auditor' && currentRole !== 'super_admin') {
    throw new Error('Permission Denied: Only Compliance Auditors can issue final deletion authorization. State Admin cannot self-approve.');
  }

  const fsReq = await getFirestoreBoundaryRequest(requestId).catch(() => null);
  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  const req = fsReq || reqs.find(r => String(r.id) === String(requestId));

  let accepted = false;
  if (!isLocalhostBackendForbidden()) {
    try {
      await client.post(`/parcels/requests/${requestId}/auditor-approve-deletion`);
      accepted = true;
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 400) {
        throw new Error(err.response?.data?.detail || err.message);
      }
      console.warn('Backend auditor deletion approval notice:', err.message);
    }
  }

  await writeSharedCopy(() => updateBoundaryRequestInFirestore(requestId, 'DELETED', currentRole), 'Final deletion approval', accepted);

  if (req && req.ulpin) {
    await recordDeletedUlpin(req.ulpin, requestId, accepted);

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

export const auditorPassRequest = async (requestId, request = null) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'auditor' && currentRole !== 'super_admin') {
    throw new Error('Permission Denied: Only Compliance Auditors can pass compliance audit.');
  }
  if (isRestOnlyRequest(request)) {
    return restPost(`/parcels/requests/${requestId}/auditor-pass`, 'Auditor review');
  }

  await writeSharedCopy(() => updateBoundaryRequestInFirestore(requestId, 'PENDING_STATE_ADMIN', currentRole), 'Passing the audit', false);

  const reqs = JSON.parse(localStorage.getItem('landsetu_pending_reqs') || '[]');
  const req = reqs.find(r => r.id === requestId);
  if (req) {
    req.status = 'PENDING_STATE_ADMIN';
    req.audited_by = 'Land Inspector & Compliance Auditor';
    localStorage.setItem('landsetu_pending_reqs', JSON.stringify(reqs));
  }
  return { status: 'PENDING_STATE_ADMIN', message: `Request #${requestId} passed compliance audit and forwarded to State Admin!`, ulpin: req?.ulpin };
};

// `record` is required when approval creates a new parcel (request.needs_record_entry): the approving officer's
// entry of owner, zoning, tax_value and encumbrance_status, stored as officer_provided.
export const approveBoundaryRequest = async (requestId, request = null, record = null) => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (currentRole !== 'state_admin' && currentRole !== 'super_admin') {
    throw new Error('Permission Denied: Only State Administration Officers (state_admin) have final approval authority.');
  }
  if (isRestOnlyRequest(request)) {
    return restPost(`/parcels/requests/${requestId}/approve`, 'Final approval', record || undefined);
  }

  // A request held only in the browser copy (Firestore or this device) never reached the records service.
  // Approving it here could not compute the parcel's area or state on the server or attest any departmental
  // record, so it cannot change a parcel. It can still be rejected.
  throw new Error(`Request ${requestId} exists only in the browser copy of the queue, so it cannot be applied to a parcel. Reject it and file the boundary again; it will then go through the records service.`);
};

// Rejecting needs remarks (at least 5 characters). The requester sees them with the request's status.
export const rejectBoundaryRequest = async (requestId, request = null, remarks = '') => {
  const currentRole = localStorage.getItem('landsetu_role') || 'citizen';
  if (!['auditor', 'state_admin', 'village_officer', 'super_admin'].includes(currentRole)) {
    throw new Error('Permission Denied: Only Village Officers, Auditors, or State Administration Officers can reject requests.');
  }
  if (isRestOnlyRequest(request)) {
    return restPost(`/parcels/requests/${requestId}/reject`, 'Rejection', { remarks });
  }

  let accepted = false;
  if (!isLocalhostBackendForbidden()) {
    try {
      await client.post(`/parcels/requests/${requestId}/reject`, { remarks });
      accepted = true;
    } catch (err) {
      if (err.response?.status === 403) {
        throw new Error(err.response?.data?.detail || err.message);
      }
      console.warn('Backend reject request notice:', err.message);
    }
  }

  await writeSharedCopy(() => updateBoundaryRequestInFirestore(requestId, 'REJECTED', currentRole), 'Rejecting the request', accepted);

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
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0201", state: "Chandigarh", owner_name: "Harpreet Singh", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.774817, 30.732139], [76.777632, 30.731902], [76.777498, 30.73398], [76.776005, 30.734128], [76.775076, 30.734115], [76.775065, 30.733047], [76.774817, 30.732139]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0202", state: "Chandigarh", owner_name: "Gurpreet Kaur", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.778098, 30.731907], [76.780651, 30.732036], [76.780301, 30.733927], [76.778667, 30.733874], [76.777761, 30.73406], [76.778069, 30.732987], [76.778098, 30.731907]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0203", state: "Chandigarh", owner_name: "Rajesh Sharma", land_use: "ecological" }, geometry: { type: "Polygon", coordinates: [[[76.784176, 30.737021], [76.785938, 30.737071], [76.786087, 30.737879], [76.786104, 30.739181], [76.78502, 30.738961], [76.784171, 30.738966], [76.784176, 30.737021]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0204", state: "Chandigarh", owner_name: "Simranjeet Singh", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.775218, 30.734469], [76.776421, 30.734661], [76.777665, 30.734568], [76.777463, 30.735485], [76.777402, 30.736535], [76.775191, 30.736638], [76.775218, 30.734469]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0205", state: "Chandigarh", owner_name: "Amit Verma", land_use: "commercial" }, geometry: { type: "Polygon", coordinates: [[[76.777934, 30.734653], [76.779474, 30.7346], [76.780638, 30.734595], [76.780293, 30.736566], [76.779208, 30.736269], [76.777804, 30.736365], [76.777934, 30.734653]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0206", state: "Chandigarh", owner_name: "Neha Gupta", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.772057, 30.732031], [76.77366, 30.731974], [76.774574, 30.731867], [76.774363, 30.733805], [76.773158, 30.734121], [76.77185, 30.734168], [76.772057, 30.732031]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0207", state: "Chandigarh", owner_name: "Kuldeep Malhotra", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.772024, 30.734683], [76.773124, 30.734576], [76.774253, 30.734613], [76.77466, 30.736654], [76.773352, 30.73637], [76.77212, 30.736624], [76.772024, 30.734683]]] } },
        { type: "Feature", properties: { ulpin: "CHD-SEC-0017-0208", state: "Chandigarh", owner_name: "Manpreet Kaur", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[76.780965, 30.732125], [76.781971, 30.731805], [76.782966, 30.731801], [76.783016, 30.734115], [76.780932, 30.73404], [76.780968, 30.733318], [76.780965, 30.732125]]] } }
      ]
    };
  }

  if (normState.includes('tamil') || normState === 'tn' || normState === 'tamilnadu') {
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1187", state: "TamilNadu", owner_name: "R. Kannan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.269817, 13.082139], [80.272632, 13.081902], [80.272498, 13.08398], [80.271005, 13.084128], [80.270076, 13.084115], [80.270065, 13.083047], [80.269817, 13.082139]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1188", state: "TamilNadu", owner_name: "M. Selvam", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.272098, 13.082907], [80.274651, 13.083036], [80.274301, 13.084927], [80.272667, 13.084874], [80.271761, 13.08506], [80.272069, 13.083987], [80.272098, 13.082907]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1189", state: "TamilNadu", owner_name: "V. Ramanathan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.275176, 13.082021], [80.276938, 13.082071], [80.277087, 13.082879], [80.277104, 13.084181], [80.27602, 13.083961], [80.275171, 13.083966], [80.275176, 13.082021]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1190", state: "TamilNadu", owner_name: "S. Lakshmi", land_use: "commercial" }, geometry: { type: "Polygon", coordinates: [[[80.270218, 13.084469], [80.271421, 13.084661], [80.272665, 13.084568], [80.272463, 13.085485], [80.272402, 13.086535], [80.270191, 13.086638], [80.270218, 13.084469]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1191", state: "TamilNadu", owner_name: "P. Murugan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.272934, 13.085653], [80.274474, 13.0856], [80.275638, 13.085595], [80.275293, 13.087566], [80.274208, 13.087269], [80.272804, 13.087365], [80.272934, 13.085653]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1192", state: "TamilNadu", owner_name: "K. Jayaraman", land_use: "commercial" }, geometry: { type: "Polygon", coordinates: [[[80.276057, 13.084531], [80.27766, 13.084474], [80.278574, 13.084367], [80.278363, 13.086305], [80.277158, 13.086621], [80.27585, 13.086668], [80.276057, 13.084531]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1193", state: "TamilNadu", owner_name: "D. Anitha", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.267024, 13.082183], [80.268124, 13.082076], [80.269253, 13.082113], [80.26966, 13.084154], [80.268352, 13.08387], [80.26712, 13.084124], [80.267024, 13.082183]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1194", state: "TamilNadu", owner_name: "G. Balaji", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.266957, 13.084625], [80.26822, 13.084266], [80.269457, 13.084301], [80.26952, 13.086615], [80.266916, 13.08654], [80.266955, 13.085818], [80.266957, 13.084625]]] } },
        { type: "Feature", properties: { ulpin: "TN-CHN-0042-1195", state: "TamilNadu", owner_name: "T. Radhakrishnan", land_use: "residential" }, geometry: { type: "Polygon", coordinates: [[[80.279176, 13.082172], [80.281266, 13.082177], [80.281215, 13.082932], [80.281285, 13.084147], [80.278976, 13.084102], [80.278867, 13.083206], [80.279176, 13.082172]]] } }
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
        { type: "Feature", properties: { zone_id: "ECO-ZONE-CHD-01", name: "Sample protected zone (placeholder)", type: "protected_zone" }, geometry: { type: "Polygon", coordinates: [[[76.782126, 30.742293], [76.782689, 30.742331], [76.78356, 30.742104], [76.784555, 30.741762], [76.78535, 30.740306], [76.786393, 30.740054], [76.787067, 30.740002], [76.787912, 30.742356], [76.788056, 30.736445], [76.787069, 30.736608], [76.786284, 30.734843], [76.785361, 30.73553], [76.784678, 30.735275], [76.783626, 30.73669], [76.783029, 30.737397], [76.781975, 30.737427], [76.782126, 30.742293]]] } }
      ]
    };
  }

  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { zone_id: "ECO-ZONE-TN-01", name: "Sample protected zone (placeholder)", type: "protected_zone" }, geometry: { type: "Polygon", coordinates: [[[80.276567, 13.08], [80.276088, 13.080312], [80.275795, 13.080709], [80.274342, 13.080673], [80.273122, 13.080842], [80.27204, 13.080625], [80.271623, 13.080297], [80.27079, 13.08], [80.271647, 13.079706], [80.271984, 13.079355], [80.273259, 13.079328], [80.274347, 13.079321], [80.275608, 13.079358], [80.276892, 13.079578], [80.276567, 13.08]]] } }
    ]
  };
};


// ---------------------------------------------------------------------------
// Split / merge / correction requests, history, search, analytics
// ---------------------------------------------------------------------------

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
const historyFromLayers = (parcel) => {
  const L = parcel?.layers || {};
  const events = [];
  const add = (date, kind, title, detail, source, confidence) =>
    events.push({ date: date || null, kind, title, detail: detail || '', source, confidence });
  if (L.ror) add(L.ror.last_verified, 'ror', `Record of Rights: owner ${L.ror.owner_name || 'not recorded'}`, `Khata ${L.ror.khata_no || 'not recorded'}`, L.ror.source, L.ror.confidence);
  if (L.registration) add(L.registration.date, 'registration', `Registration: ${L.registration.transaction_type || 'transaction'} ${L.registration.last_transaction_id || ''}`.trim(), L.registration.buyer_name ? `Buyer ${L.registration.buyer_name}` : '', L.registration.source, L.registration.confidence);
  if (L.building_permit) add(L.building_permit.date, 'permit', `Building permit ${L.building_permit.permit_id || ''} ${L.building_permit.status || ''}`.trim(), L.building_permit.approved_fsi != null ? `Approved FSI ${L.building_permit.approved_fsi}` : '', L.building_permit.source, L.building_permit.confidence);
  if (L.tax) add(L.tax.last_verified, 'tax', 'Property tax assessed', L.tax.annual_value ? `Annual value Rs ${L.tax.annual_value}` : '', L.tax.source, L.tax.confidence);
  events.sort((a, b) => (a.date === null) - (b.date === null) || String(a.date).localeCompare(String(b.date)));
  return events;
};

export const getParcelHistory = async (ulpin) => {
  if (!isLocalhostBackendForbidden()) {
    try {
      const res = await client.get(`/parcels/${encodeURIComponent(ulpin)}/history`);
      if (Array.isArray(res.data?.events)) return { events: res.data.events, source: 'live' };
    } catch (err) { /* fall through to layer-only history */ }
  }
  const parcel = await getParcelDetail(ulpin);
  return { events: historyFromLayers(parcel), source: 'offline' };
};

export const searchParcels = async (q, state) => {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  if (!isLocalhostBackendForbidden()) {
    try {
      const res = await client.get('/parcels/search', { params: { q: term, state: state || undefined } });
      if (Array.isArray(res.data)) return res.data;
    } catch (err) { /* offline fallback below */ }
  }
  const needle = term.toLowerCase();
  const local = JSON.parse(localStorage.getItem('landsetu_custom_parcels') || '{}');
  const seeds = ['TamilNadu', 'Chandigarh'].flatMap((st) => getFallbackSeedParcelsGeoJSON(st).features.map((f) => ({
    ulpin: f.properties.ulpin, state: f.properties.state, owner_name: f.properties.owner_name, khata_no: null, geometry: f.geometry,
  })));
  const custom = Object.values(local).map((p) => ({
    ulpin: p.ulpin, state: p.state, owner_name: p.layers?.ror?.owner_name, khata_no: p.layers?.ror?.khata_no, geometry: p.geometry,
  }));
  return [...seeds, ...custom]
    .filter((p) => [p.ulpin, p.owner_name, p.khata_no].some((v) => String(v || '').toLowerCase().includes(needle)))
    .slice(0, 20)
    .map((p) => {
      const ring = p.geometry?.coordinates?.[0] || [];
      const n = Math.max(ring.length - 1, 1);
      const centroid = ring.length ? [ring.slice(0, n).reduce((a, c) => a + c[0], 0) / n, ring.slice(0, n).reduce((a, c) => a + c[1], 0) / n] : null;
      const matched_on = String(p.ulpin).toLowerCase().includes(needle) ? 'ulpin' : String(p.owner_name || '').toLowerCase().includes(needle) ? 'owner' : 'khata';
      return { ulpin: p.ulpin, state: p.state, owner_name: p.owner_name, khata_no: p.khata_no, centroid, matched_on };
    });
};

// Account and role administration (super administrators). These need the live records service.
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
export const getParcelIntelligence = (ulpin) => restCall('get', `/parcels/${encodeURIComponent(ulpin)}/intelligence`, 'Statistical signals');
export const getIntelligenceSummary = () => restCall('get', '/parcels/analytics/intelligence', 'Statistical summary');
