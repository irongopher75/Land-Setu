import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

export const mockLogin = async (role) => {
  const res = await client.post('/auth/mock-login', { role });
  return res.data;
};

export const firebaseLogin = async (idToken) => {
  const res = await client.post('/auth/firebase-login', { id_token: idToken });
  return res.data;
};

export const logout = async () => client.post('/auth/logout');

export const listParcels = async (state) => {
  const params = state ? { state } : {};
  const res = await client.get('/parcels', { params });
  return res.data;
};

export const getParcelsGeoJSON = async (state) => {
  const params = state ? { state } : {};
  const res = await client.get('/parcels/geojson/all', { params });
  return res.data;
};

export const getProtectedZonesGeoJSON = async (state) => {
  const params = state ? { state } : {};
  const res = await client.get('/parcels/protected-zones/geojson', { params });
  return res.data;
};

export const getParcelDetail = async (ulpin) => {
  const res = await client.get(`/parcels/${ulpin}`);
  return res.data;
};

export const getParcelFlags = async (ulpin) => {
  const res = await client.get(`/parcels/${ulpin}/flags`);
  return res.data;
};

export const getParcelPassport = async (ulpin) => {
  const res = await client.get(`/parcels/${ulpin}/passport`);
  return res.data;
};

export const previewAdapter = async (state, rawRecord) => {
  const res = await client.post('/adapter/preview', { state, raw_record: rawRecord });
  return res.data;
};

export const getRawSamples = async () => {
  const res = await client.get('/adapter/raw-samples');
  return res.data;
};

export const createCustomParcel = async (parcelData) => {
  const res = await client.post('/parcels/custom', parcelData);
  return res.data;
};

export const getAllStates = async () => {
  const res = await client.get('/parcels/states/all');
  return res.data;
};

export const getPendingRequests = async () => {
  const res = await client.get('/parcels/requests/pending');
  return res.data;
};

export const approveBoundaryRequest = async (requestId) => {
  const res = await client.post(`/parcels/requests/${requestId}/approve`);
  return res.data;
};

export const rejectBoundaryRequest = async (requestId) => {
  const res = await client.post(`/parcels/requests/${requestId}/reject`);
  return res.data;
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
  try {
    const res = await client.get('/parcels/identify-state', { params: { lat, lng } });
    return res.data;
  } catch (err) {
    for (const state of LOCAL_STATES) {
      const b = state.bbox;
      if (lat >= b.min_lat && lat <= b.max_lat && lng >= b.min_lng && lng <= b.max_lng) {
        return state;
      }
    }
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
    return closest;
  }
};
