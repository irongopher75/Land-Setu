import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to attach JWT token
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('landsetu_jwt_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const mockLogin = async (role) => {
  const res = await client.post('/auth/mock-login', { role });
  if (res.data && res.data.access_token) {
    localStorage.setItem('landsetu_jwt_token', res.data.access_token);
    localStorage.setItem('landsetu_role', res.data.role);
  }
  return res.data;
};

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

