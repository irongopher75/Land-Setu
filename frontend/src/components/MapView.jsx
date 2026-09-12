import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { PlusCircle, Edit3, Check, X, MapPin, Sparkles, Search, Lock, Navigation, Target, ClipboardList, AlertTriangle } from 'lucide-react';
import { getParcelsGeoJSON, getProtectedZonesGeoJSON, createCustomParcel, identifyStateByCoords, getPendingRequests, getApprovedCustomParcels } from '../api';
import ApprovalQueueModal from './ApprovalQueueModal';

// Mock parcel rectangles are deliberately hidden by default. Set this only for
// a controlled data demo, never for a public map with unreviewed mock records.
const SHOW_SEEDED_PARCELS = import.meta.env.VITE_SHOW_SEEDED_PARCELS === 'true';

// Draggable Vertex Handle Icon
const handleIcon = L.divIcon({
  className: 'custom-vertex-marker',
  html: '<div style="width: 18px; height: 18px; background: #06b6d4; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 14px rgba(6,182,212,0.9); cursor: grab;"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

// GPS User Location Icon
const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: '<div style="width: 24px; height: 24px; background: #3b82f6; border: 3.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 24px #3b82f6, 0 0 0 12px rgba(59, 130, 246, 0.25); cursor: pointer;"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

// Map Focus Handler that ONLY flies on explicit state focus change, preserving user zoom/resolution while editing
function MapFocusHandler({ stateCenter, zoom, selectedState }) {
  const map = useMap();
  const lastState = useRef(selectedState);

  useEffect(() => {
    if (selectedState && lastState.current !== selectedState) {
      lastState.current = selectedState;
      const currentCenter = map.getCenter();
      const dist = Math.hypot(currentCenter.lat - stateCenter[0], currentCenter.lng - stateCenter[1]);
      if (dist > 2.0) {
        map.flyTo(stateCenter, zoom, { duration: 1.2 });
      }
    }
  }, [selectedState, stateCenter, zoom, map]);

  return null;
}

// Map Event Listener for click positioning and real-time state identification on map move
function MapEventListener({ isDrawingMode, onMapClick, onMapMoveEnd, onPointerMove }) {
  useMapEvents({
    click(e) {
      if (isDrawingMode) {
        onMapClick([e.latlng.lat, e.latlng.lng]);
      }
    },
    moveend(e) {
      const center = e.target.getCenter();
      onMapMoveEnd(center.lat, center.lng);
    },
    mousemove(e) {
      if (onPointerMove) {
        onPointerMove(e.latlng.lat, e.latlng.lng);
      }
    }
  });
  return null;
}

// Area calculation helper (sqm)
function calculatePolygonAreaSqm(latLngs) {
  if (!latLngs || latLngs.length < 3) return 0;
  const radius = 6378137;
  let area = 0;
  for (let i = 0; i < latLngs.length; i++) {
    const p1 = latLngs[i];
    const p2 = latLngs[(i + 1) % latLngs.length];
    const rad1 = (p1[0] * Math.PI) / 180;
    const rad2 = (p2[0] * Math.PI) / 180;
    const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
    area += dLng * (2 + Math.sin(rad1) + Math.sin(rad2));
  }
  area = (area * radius * radius) / 4;
  return Math.abs(Math.round(area * 10) / 10);
}

// Spatial Overlap Detection Helper using Turf
const evaluateParcelsOverlap = (featureCollection, protectedZones) => {
  if (!featureCollection || !featureCollection.features) return featureCollection;

  const features = featureCollection.features.map(f => ({
    ...f,
    properties: {
      ...f.properties,
      has_overlap: false,
      overlapping_with: [],
      overlap_reasons: []
    }
  }));

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      try {
        const polyA = features[i];
        const polyB = features[j];

        if (!polyA.geometry || !polyB.geometry) continue;

        if (turf.booleanIntersects(polyA, polyB)) {
          const intersection = turf.intersect(polyA, polyB);
          if (intersection) {
            const overlapAreaSqm = turf.area(intersection);
            if (overlapAreaSqm > 0.5) {
              const ulpinA = polyA.properties?.ulpin || `Parcel ${i + 1}`;
              const ulpinB = polyB.properties?.ulpin || `Parcel ${j + 1}`;

              features[i].properties.has_overlap = true;
              features[i].properties.has_flags = true;
              if (!features[i].properties.overlapping_with.includes(ulpinB)) {
                features[i].properties.overlapping_with.push(ulpinB);
                features[i].properties.overlap_reasons.push(`Overlaps with ${ulpinB} (${overlapAreaSqm.toFixed(1)} sqm)`);
              }

              features[j].properties.has_overlap = true;
              features[j].properties.has_flags = true;
              if (!features[j].properties.overlapping_with.includes(ulpinA)) {
                features[j].properties.overlapping_with.push(ulpinA);
                features[j].properties.overlap_reasons.push(`Overlaps with ${ulpinA} (${overlapAreaSqm.toFixed(1)} sqm)`);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Overlap computation notice:', err);
      }
    }

    if (protectedZones && protectedZones.features) {
      for (const zone of protectedZones.features) {
        try {
          if (!features[i].geometry || !zone.geometry) continue;
          if (turf.booleanIntersects(features[i], zone)) {
            const intersection = turf.intersect(features[i], zone);
            if (intersection && turf.area(intersection) > 0.5) {
              const zoneName = zone.properties?.name || 'Protected Eco Zone';
              features[i].properties.has_overlap = true;
              features[i].properties.has_flags = true;
              if (!features[i].properties.overlapping_with.includes(zoneName)) {
                features[i].properties.overlapping_with.push(zoneName);
                features[i].properties.overlap_reasons.push(`Overlaps with Protected Zone: ${zoneName}`);
              }
            }
          }
        } catch (e) {}
      }
    }
  }

  return { ...featureCollection, features };
};

export default function MapView({ selectedState, onSelectParcel, selectedUlpin, editingParcel, onClearEditingParcel, onAutoDetectState, role = 'citizen' }) {
  const [parcelsGeoJSON, setParcelsGeoJSON] = useState(null);
  const [protectedGeoJSON, setProtectedGeoJSON] = useState(null);

  // User GPS Location state
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Approval Workflow Queue state
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Auto-detected state info
  const [detectedStateInfo, setDetectedStateInfo] = useState({ label: 'Tamil Nadu', name: 'TamilNadu', capital: 'Chennai' });

  // Custom Interactive Boundary Drawer state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [vertices, setVertices] = useState([]);
  const [reshapeError, setReshapeError] = useState('');
  const [customUlpin, setCustomUlpin] = useState('');
  const [customOwner, setCustomOwner] = useState('');
  const [selectedLandUse, setSelectedLandUse] = useState('residential');
  const [saving, setSaving] = useState(false);
  const mapRef = useRef(null);
  const stateLookupTimer = useRef(null);

  const stateCenters = {
    TamilNadu: { center: [13.084, 80.274], zoom: 15 },
    Chandigarh: { center: [30.735, 76.778], zoom: 15 },
    Maharashtra: { center: [19.076, 72.877], zoom: 14 },
    Karnataka: { center: [12.971, 77.594], zoom: 14 },
    Delhi: { center: [28.613, 77.209], zoom: 14 },
    Telangana: { center: [17.385, 78.486], zoom: 14 },
    Kerala: { center: [9.931, 76.267], zoom: 14 },
    WestBengal: { center: [22.572, 88.363], zoom: 14 },
    Gujarat: { center: [23.022, 72.571], zoom: 14 },
    Rajasthan: { center: [26.912, 75.787], zoom: 14 },
    UttarPradesh: { center: [26.846, 80.946], zoom: 14 },
    Punjab: { center: [30.901, 75.857], zoom: 14 },
    MadhyaPradesh: { center: [23.259, 77.412], zoom: 14 }
  };

  const currentFocus = stateCenters[selectedState] || stateCenters.TamilNadu;

  // Land Use / Zoning Ownership Color Customization Theme Helper
  const getLandUseTheme = (landUseStr = 'residential') => {
    const lower = String(landUseStr).toLowerCase();
    if (lower.includes('eco') || lower.includes('protect') || lower.includes('forest')) {
      return { fill: '#a855f7', border: '#8b5cf6', label: '🌿 Ecological / Forest Zone' };
    }
    if (lower.includes('agri') || lower.includes('farm') || lower.includes('crop')) {
      return { fill: '#eab308', border: '#d97706', label: '🌾 Agricultural Area' };
    }
    if (lower.includes('indus') || lower.includes('factory') || lower.includes('manufactur')) {
      return { fill: '#ea580c', border: '#c2410c', label: '🏭 Industrial Area' };
    }
    if (lower.includes('trans') || lower.includes('road') || lower.includes('infra') || lower.includes('comm')) {
      return { fill: '#06b6d4', border: '#0f766e', label: '🚗 Transport / Infra Area' };
    }
    return { fill: '#3b82f6', border: '#1d4ed8', label: '🏡 Residential Area' };
  };

  // Fetch real-time GPS user location and reset map view directly onto location
  const locateUserAndCenter = (isInitial = false) => {
    if (!navigator.geolocation) {
      if (!isInitial) setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    setLocating(true);
    setLocationError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const coords = [latitude, longitude];
        setUserLocation(coords);
        setLocating(false);

        // Fly map smoothly to exact user coordinates
        if (mapRef.current) {
          mapRef.current.flyTo(coords, 15, { duration: 1.5 });
        }

        // Auto spatial identification of Indian state for user position
        try {
          const info = await identifyStateByCoords(latitude, longitude);
          if (info && info.name) {
            setDetectedStateInfo(info);
            if (onAutoDetectState) {
              onAutoDetectState(info.name);
            }
          }
        } catch (err) {
          console.warn('Auto location state identification notice:', err);
        }
      },
      (err) => {
        setLocating(false);
        console.warn('Geolocation error:', err.message);
        if (!isInitial) {
          setLocationError(`Location Access Error: ${err.message}. Please enable location permissions in your browser.`);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const fetchPendingCount = async () => {
    try {
      const pending = await getPendingRequests();
      setPendingCount(pending.length);
    } catch (err) {
      console.warn('Pending requests fetch notice:', err);
    }
  };

  // Locate user on initial component mount
  useEffect(() => {
    locateUserAndCenter(true);
    fetchPendingCount();
  }, []);

  useEffect(() => {
    loadMapData();
    fetchPendingCount();
  }, [selectedState, role]);

  // Load existing parcel coordinates when user clicks "Reshape Boundary" from ParcelPanel
  useEffect(() => {
    if (editingParcel && editingParcel.geometry && editingParcel.geometry.coordinates) {
      const coords = editingParcel.geometry.coordinates[0];
      const leafletCoords = coords.slice(0, -1).map(([lng, lat]) => [lat, lng]);
      setVertices(leafletCoords);
      setCustomUlpin(editingParcel.ulpin);
      setCustomOwner(editingParcel.layers?.ror?.owner_name || 'Parcel Owner');
      setSelectedLandUse(editingParcel.layers?.zoning?.land_use || editingParcel.land_use || 'residential');
      setIsDrawingMode(true);
    }
  }, [editingParcel]);

  const loadMapData = async () => {
    try {
      const [parcelsData, zonesData, customParcels] = await Promise.all([
        getParcelsGeoJSON(selectedState).catch(() => null),
        getProtectedZonesGeoJSON(selectedState).catch(() => null),
        getApprovedCustomParcels().catch(() => ({})),
      ]);

      const customFeatures = Object.values(customParcels || {})
        .filter(p => (p.state === selectedState || !p.state) && p.geometry)
        .map(p => ({
          type: 'Feature',
          properties: {
            ulpin: p.ulpin,
            state: p.state || selectedState,
            area_sqm: p.area_sqm,
            owner_name: p.layers?.ror?.owner_name,
            land_use: p.land_use || p.layers?.zoning?.land_use || 'residential',
            is_approved: true,
            status: 'APPROVED',
            has_flags: p.flags && p.flags.length > 0
          },
          geometry: p.geometry
        }));

      let mergedParcels = parcelsData || { type: 'FeatureCollection', features: [] };
      if (customFeatures.length > 0) {
        // Ensure duplicates by ULPIN are replaced with the latest approved custom feature
        const existingUlpins = new Set(customFeatures.map(cf => cf.properties.ulpin));
        const filteredBackend = (mergedParcels.features || []).filter(f => !existingUlpins.has(f.properties?.ulpin));

        mergedParcels = {
          ...mergedParcels,
          features: [...filteredBackend, ...customFeatures]
        };
      }

      const enrichedParcels = evaluateParcelsOverlap(mergedParcels, zonesData);
      setParcelsGeoJSON(enrichedParcels);
      setProtectedGeoJSON(zonesData);
    } catch (err) {
      console.error('Failed to load map GeoJSON layers:', err);
    }
  };

  // Real-time calculation of drawing conflicts with existing map parcels
  const getDrawingOverlapConflicts = () => {
    if (!isDrawingMode || !vertices || vertices.length < 3 || !parcelsGeoJSON || !parcelsGeoJSON.features) {
      return [];
    }
    try {
      const coords = vertices.map(([lat, lng]) => [lng, lat]);
      coords.push([coords[0][0], coords[0][1]]);
      const drawnPoly = turf.polygon([coords]);

      const conflicts = [];
      for (const f of parcelsGeoJSON.features) {
        if (editingParcel && f.properties?.ulpin === editingParcel.ulpin) continue;
        if (!f.geometry) continue;
        if (turf.booleanIntersects(drawnPoly, f)) {
          const inter = turf.intersect(drawnPoly, f);
          if (inter) {
            const area = turf.area(inter);
            if (area > 0.5) {
              const name = f.properties?.ulpin || f.properties?.owner_name || 'Neighboring Parcel';
              conflicts.push(`Parcel ${name} (Overlap: ${area.toFixed(1)} sqm)`);
            }
          }
        }
      }

      if (protectedGeoJSON && protectedGeoJSON.features) {
        for (const zone of protectedGeoJSON.features) {
          if (!zone.geometry) continue;
          if (turf.booleanIntersects(drawnPoly, zone)) {
            const inter = turf.intersect(drawnPoly, zone);
            if (inter) {
              const area = turf.area(inter);
              if (area > 0.5) {
                const name = zone.properties?.name || 'Protected Eco Zone';
                conflicts.push(`🛡️ ${name} (Overlap: ${area.toFixed(1)} sqm)`);
              }
            }
          }
        }
      }

      return conflicts;
    } catch (err) {
      console.warn('Drawing overlap computation notice:', err);
      return [];
    }
  };

  const drawingConflicts = getDrawingOverlapConflicts();
  const isDrawingOverlapping = drawingConflicts.length > 0;

  // Real-time spatial identification on map move or cursor hover
  const processSpatialIdentification = (lat, lng) => {
    clearTimeout(stateLookupTimer.current);
    stateLookupTimer.current = setTimeout(async () => {
      try {
        const info = await identifyStateByCoords(lat, lng);
        if (info && info.name) {
          setDetectedStateInfo(info);
          if (onAutoDetectState && info.name !== selectedState) {
            onAutoDetectState(info.name);
          }
        }
      } catch (err) {
        console.error('Spatial auto-identification failed:', err);
      }
    }, 150);
  };

  const handleMapMoveEnd = (lat, lng) => processSpatialIdentification(lat, lng);
  const handlePointerMove = (lat, lng) => processSpatialIdentification(lat, lng);

  // Start drawing boundary centered at CURRENT MAP VIEWPORT (preserves user zoom/resolution)
  const startDrawing = () => {
    if (role === 'citizen') {
      alert("🔒 Permission Denied: Citizens have Read-Only access and cannot mark or reshape boundaries. Switch to Revenue Officer role to mark boundaries.");
      return;
    }
    let centerLat = currentFocus.center[0];
    let centerLng = currentFocus.center[1];

    if (mapRef.current) {
      const center = mapRef.current.getCenter();
      centerLat = center.lat;
      centerLng = center.lng;
    }

    const numPoints = 5;
    const radius = 0.0006;
    const initialRing = [];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i * 2 * Math.PI) / numPoints;
      const lat = centerLat + radius * Math.cos(angle);
      const lng = centerLng + (radius * Math.sin(angle)) / Math.cos((centerLat * Math.PI) / 180);
      initialRing.push([lat, lng]);
    }

    setVertices(initialRing);
    const prefix = selectedState.slice(0, 2).toUpperCase();
    setCustomUlpin(`${prefix}-MANUAL-${Math.floor(1000 + Math.random() * 9000)}`);
    setCustomOwner('Citizen / Custom Owner');
    setSelectedLandUse('residential');
    setIsDrawingMode(true);
    setReshapeError('');
  };

  const cancelDrawing = () => {
    setIsDrawingMode(false);
    setVertices([]);
    setReshapeError('');
    if (onClearEditingParcel) onClearEditingParcel();
  };

  // Add vertex handle at exact clicked position on map
  const handleMapClickPosition = (lat, lng) => {
    if (!isDrawingMode) return;
    setVertices((prev) => [...prev, [lat, lng]]);
  };

  // Drag handle update
  const handleVertexDrag = (index, newLat, newLng) => {
    setVertices((prev) => {
      const updated = [...prev];
      updated[index] = [newLat, newLng];
      return updated;
    });
  };

  // Save boundary changes & re-run spatial rules engine
  const saveCustomBoundary = async () => {
    if (vertices.length < 3) {
      setReshapeError('A parcel polygon requires at least 3 vertex points.');
      return;
    }
    setSaving(true);
    setReshapeError('');

    // Strict India Geographical Bounds Validation (Lat: 6.5°N - 35.7°N, Lng: 68.1°E - 97.4°E)
    const isInsideIndia = vertices.every(
      ([lat, lng]) => lat >= 6.5 && lat <= 35.7 && lng >= 68.1 && lng <= 97.4
    );

    if (!isInsideIndia) {
      setReshapeError('⚠️ Land allocation is strictly restricted within the territory of India (Lat: 6.5°-35.7°N, Lng: 68.1°-97.4°E).');
      setSaving(false);
      return;
    }

    const geojsonCoordinates = vertices.map(([lat, lng]) => [lng, lat]);
    geojsonCoordinates.push([vertices[0][1], vertices[0][0]]);

    const geojsonPolygon = {
      type: 'Polygon',
      coordinates: [geojsonCoordinates]
    };

    const areaSqm = calculatePolygonAreaSqm(vertices);

    const sumLat = vertices.reduce((acc, v) => acc + v[0], 0);
    const sumLng = vertices.reduce((acc, v) => acc + v[1], 0);
    const cLat = sumLat / vertices.length;
    const cLng = sumLng / vertices.length;

    const detected = await identifyStateByCoords(cLat, cLng);
    const targetState = detected?.name || selectedState;

    try {
      const result = await createCustomParcel({
        ulpin: customUlpin,
        state: targetState,
        owner_name: customOwner,
        land_use: selectedLandUse,
        geometry: geojsonPolygon,
        area_sqm: areaSqm
      });

      if (result.status === 'PENDING_APPROVAL' || result.status === 'PENDING_AUDITOR_REVIEW') {
        alert(`📩 ${result.message}`);
        setIsDrawingMode(false);
        setVertices([]);
        setReshapeError('');
        if (onClearEditingParcel) onClearEditingParcel();
        fetchPendingCount();
        return;
      }

      alert("✅ Boundary change approved & committed to master GIS database!");

      if (onAutoDetectState && targetState !== selectedState) {
        onAutoDetectState(targetState);
      }

      await loadMapData();
      fetchPendingCount();
      setIsDrawingMode(false);
      setVertices([]);
      setReshapeError('');
      if (onClearEditingParcel) onClearEditingParcel();
      onSelectParcel(result.ulpin);
    } catch (err) {
      console.error('Failed to save custom boundary:', err);
      const msg = err.response?.data?.detail || err.message || 'Evaluation error';
      setReshapeError(`⚠️ ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // Parcel Polygon Styling
  const getParcelStyle = (feature) => {
    const isSelected = feature.properties?.ulpin === selectedUlpin;
    const isApproved = feature.properties?.is_approved || feature.properties?.status === 'APPROVED';
    const hasFlags = feature.properties?.has_flags;
    const hasOverlap = feature.properties?.has_overlap;
    const landUse = feature.properties?.land_use || feature.properties?.zone_category || feature.properties?.layers?.zoning?.land_use || 'residential';
    const theme = getLandUseTheme(landUse);

    // CRITICAL USER RULE: OVERLAPPING ZONES MUST TURN TO RED!
    if (hasOverlap) {
      return {
        fillColor: '#ef4444', // Red Fill
        fillOpacity: isSelected ? 0.85 : 0.65,
        color: '#b91c1c', // Dark Crimson
        weight: isSelected ? 5.5 : 4,
        dashArray: '4, 4'
      };
    }

    if (isSelected) {
      return {
        fillColor: theme.fill,
        fillOpacity: 0.75,
        color: '#ffffff',
        weight: 4.5,
        dashArray: ''
      };
    }

    if (isApproved) {
      return {
        fillColor: theme.fill,
        fillOpacity: 0.55,
        color: theme.border,
        weight: 3.5,
        dashArray: ''
      };
    }

    if (hasFlags) {
      return {
        fillColor: '#ef4444',
        fillOpacity: 0.5,
        color: '#dc2626',
        weight: 3,
        dashArray: ''
      };
    }

    return {
      fillColor: theme.fill,
      fillOpacity: 0.4,
      color: theme.border,
      weight: 2,
      dashArray: ''
    };
  };

  const protectedZoneStyle = {
    fillColor: '#a855f7',
    fillOpacity: 0.25,
    color: '#c084fc',
    weight: 2,
    dashArray: '6, 6'
  };

  const onEachParcel = (feature, layer) => {
    const props = feature.properties;
    if (!props) return;

    const isApproved = props.is_approved || props.status === 'APPROVED';
    const hasOverlap = props.has_overlap;
    const landUse = props.land_use || props.zone_category || props.layers?.zoning?.land_use || 'residential';
    const theme = getLandUseTheme(landUse);

    const tooltipContent = `
      <div style="font-family: sans-serif; font-size: 12px; padding: 4px; max-width: 270px;">
        ${hasOverlap ? `
          <div style="background-color: #fef2f2; border: 1.5px solid #ef4444; border-radius: 6px; padding: 6px; margin-bottom: 6px;">
            <strong style="color: #dc2626; font-size: 12px; display: flex; align-items: center; gap: 4px;">⚠️ CAUTION: OVERLAPPING ZONE DETECTED!</strong>
            <div style="color: #991b1b; font-size: 11px; margin-top: 3px; line-height: 1.3;">
              Spatial conflict with: <strong>${(props.overlapping_with || []).join(', ')}</strong>
            </div>
          </div>
        ` : ''}
        <strong style="color: #1d4ed8;">ULPIN: ${props.ulpin}</strong><br/>
        ${props.owner_name ? `Owner: <strong>${props.owner_name}</strong><br/>` : ''}
        Zoning Category: <strong style="color: ${theme.border};">${theme.label}</strong><br/>
        Status: <span style="color: ${hasOverlap ? '#dc2626' : isApproved ? '#059669' : props.has_flags ? '#ef4444' : '#10b981'}; font-weight: bold;">
          ${hasOverlap ? '⚠️ OVERLAP CONFLICT (RED)' : isApproved ? '✅ OFFICIAL APPROVED BOUNDARY' : props.has_flags ? `⚠️ Flagged (${props.flag_count} rules)` : '✅ Clean'}
        </span>
      </div>
    `;

    layer.bindTooltip(tooltipContent, { sticky: true, className: 'custom-map-tooltip' });

    layer.on({
      click: () => {
        if (!isDrawingMode) {
          onSelectParcel(props.ulpin);
        }
      },
      mouseover: (e) => {
        if (!isDrawingMode) {
          e.target.setStyle({ fillOpacity: 0.85, weight: 4.5 });
        }
      },
      mouseout: (e) => {
        layer.setStyle(getParcelStyle(feature));
      }
    });
  };

  const currentArea = calculatePolygonAreaSqm(vertices);

  return (
    <div className="map-view-container">
      <MapContainer
        ref={mapRef}
        center={currentFocus.center}
        zoom={currentFocus.zoom}
        scrollWheelZoom={true}
        zoomControl={false}
      >
        <MapFocusHandler stateCenter={currentFocus.center} zoom={currentFocus.zoom} selectedState={selectedState} />
        <MapEventListener
          isDrawingMode={isDrawingMode}
          onMapClick={handleMapClickPosition}
          onMapMoveEnd={handleMapMoveEnd}
          onPointerMove={handlePointerMove}
        />

        {/* Light, high-contrast basemap with CARTO API key */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_3gmv_1_ce82e9ddc32b820ba54c3a97"
        />

        {/* Protected Eco-Zones Layer */}
        {protectedGeoJSON && (
          <GeoJSON
            key={`protected-${selectedState}`}
            data={protectedGeoJSON}
            style={protectedZoneStyle}
            onEachFeature={(feat, layer) => {
              layer.bindTooltip(`🛡️ ${feat.properties.name}`, { sticky: true });
            }}
          />
        )}

        {/* Parcels Layer */}
        {parcelsGeoJSON && (
          <GeoJSON
            key={`parcels-${selectedState}-${parcelsGeoJSON.features?.length || 0}`}
            data={parcelsGeoJSON}
            style={getParcelStyle}
            onEachFeature={onEachParcel}
          />
        )}

        {/* Interactive Custom Boundary Reshaper Layer */}
        {isDrawingMode && (
          <>
            <Polygon
              positions={vertices}
              pathOptions={{
                color: isDrawingOverlapping ? '#b91c1c' : getLandUseTheme(selectedLandUse).border,
                fillColor: isDrawingOverlapping ? '#ef4444' : getLandUseTheme(selectedLandUse).fill,
                fillOpacity: isDrawingOverlapping ? 0.75 : 0.55,
                weight: isDrawingOverlapping ? 4.5 : 3,
                dashArray: '6, 6'
              }}
            />
            {vertices.map((pos, idx) => (
              <Marker
                key={idx}
                position={pos}
                icon={handleIcon}
                draggable={true}
                eventHandlers={{
                  drag: (e) => {
                    const latLng = e.target.getLatLng();
                    handleVertexDrag(idx, latLng.lat, latLng.lng);
                  }
                }}
              />
            ))}
          </>
        )}

        {/* Live GPS User Location Marker */}
        {userLocation && (
          <Marker position={userLocation} icon={userLocationIcon}>
            <Polygon
              positions={[
                [userLocation[0] + 0.001, userLocation[1] + 0.001],
                [userLocation[0] - 0.001, userLocation[1] + 0.001],
                [userLocation[0] - 0.001, userLocation[1] - 0.001],
                [userLocation[0] + 0.001, userLocation[1] - 0.001]
              ]}
              pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1.5, dashArray: '4, 4' }}
            />
          </Marker>
        )}
      </MapContainer>

      {/* Top Map Action Bar & Auto State Detection Pill */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 900, display: 'flex', flexDirection: 'column', gap: '10px' }} className="map-toolbar">
        {/* Real-Time Auto-Identified Location Pill & Locate Me Button */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '8px 14px', borderRadius: '20px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#0f172a', boxShadow: '0 4px 16px rgba(15,23,42,0.1)' }}>
            <MapPin size={14} color="var(--accent-primary)" />
            <span>Auto-Identified State: <strong style={{ color: 'var(--accent-primary)' }}>{detectedStateInfo.label || detectedStateInfo.name}</strong> ({detectedStateInfo.capital})</span>
            <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '10px', fontWeight: 700 }}>
              AUTO SPATIAL
            </span>
          </div>

          <button
            className="passport-btn"
            style={{
              width: 'auto',
              padding: '8px 14px',
              fontSize: '0.82rem',
              background: '#ffffff',
              color: '#0f172a',
              border: '1px solid #cbd5e1',
              borderRadius: '20px'
            }}
            onClick={() => locateUserAndCenter(false)}
            disabled={locating}
          >
            <Navigation size={14} style={{ animation: locating ? 'spin 1s linear infinite' : 'none' }} />
            {locating ? 'Locating...' : '🎯 Reset to My Location'}
          </button>

          {role !== 'citizen' && (
            <button
              className="passport-btn"
              style={{
                width: 'auto',
                padding: '8px 14px',
                fontSize: '0.82rem',
                background: 'linear-gradient(135deg, #0284c7, #0d9488)',
                borderRadius: '20px',
                boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)'
              }}
              onClick={() => setShowApprovalModal(true)}
            >
              <ClipboardList size={14} /> Approval Pipeline ({pendingCount})
            </button>
          )}
        </div>

        {locationError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span>{locationError}</span>
            <button onClick={() => setLocationError('')} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>
              <X size={14} />
            </button>
          </div>
        )}

        {role === 'citizen' ? (
          <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '10px 16px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: '#0f172a', boxShadow: '0 4px 16px rgba(15,23,42,0.1)' }}>
            <Lock size={16} color="#b45309" />
            <span>Mode: <strong style={{ color: '#b45309' }}>Citizen (Read-Only)</strong> &bull; Boundary Marking Restricted</span>
          </div>
        ) : !isDrawingMode ? (
          <button className="passport-btn" style={{ width: 'auto', padding: '10px 18px', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }} onClick={startDrawing}>
            <Edit3 size={16} /> {role === 'village_officer' ? '📩 Issue Boundary Change Request' : 'Draw / Reshape Boundary'} ({role === 'village_officer' ? 'Village Office' : role === 'auditor' ? 'Auditor' : 'State Admin'})
          </button>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px', width: '350px', boxShadow: '0 8px 32px rgba(15,23,42,0.15)', color: '#0f172a' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: isDrawingOverlapping ? '#dc2626' : 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>📐 Boundary Reshaper ({vertices.length} Handles)</span>
              <button onClick={cancelDrawing} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {/* REAL-TIME CAUTION ALERT BANNER FOR OVERLAPPING ZONES */}
            {isDrawingOverlapping && (
              <div style={{ background: '#fef2f2', border: '1.5px solid #ef4444', color: '#b91c1c', padding: '10px', borderRadius: '8px', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', color: '#dc2626' }}>
                  <AlertTriangle size={16} /> ⚠️ CAUTION: OVERLAPPING ZONE DETECTED!
                </div>
                <div style={{ fontSize: '0.74rem', color: '#7f1d1d' }}>
                  The marked geometry intersects with existing zone(s):
                </div>
                <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.74rem', fontWeight: 600, color: '#991b1b' }}>
                  {drawingConflicts.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ fontSize: '0.78rem', color: '#0369a1', background: '#e0f2fe', padding: '8px', borderRadius: '6px', border: '1px solid #bae6fd' }}>
              💡 Drag blue handles OR click anywhere on map to add vertex points at your exact current resolution!
            </div>

            <div style={{ fontSize: '0.85rem', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a', padding: '8px 12px', borderRadius: '8px' }}>
              Computed Area: <strong style={{ color: '#15803d' }}>{currentArea} sqm</strong>
            </div>

            {reshapeError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 10px', borderRadius: '6px', fontSize: '0.78rem', lineHeight: 1.4 }}>
                {reshapeError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                value={customUlpin}
                onChange={(e) => setCustomUlpin(e.target.value)}
                placeholder="Target ULPIN"
                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '6px 10px', borderRadius: '6px', fontSize: '0.82rem' }}
              />
              <input
                type="text"
                value={customOwner}
                onChange={(e) => setCustomOwner(e.target.value)}
                placeholder="Owner Name"
                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '6px 10px', borderRadius: '6px', fontSize: '0.82rem' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Zoning / Land Use Category:</label>
                <select
                  value={selectedLandUse}
                  onChange={(e) => setSelectedLandUse(e.target.value)}
                  style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '6px 10px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 700 }}
                >
                  <option value="residential">🏡 Residential Area (Royal Blue)</option>
                  <option value="agricultural">🌾 Agricultural Area (Amber Gold)</option>
                  <option value="industrial">🏭 Industrial Area (Orange)</option>
                  <option value="ecological">🌿 Ecological / Forest Zone (Purple)</option>
                  <option value="transport">🚗 Transport / Commercial (Teal Cyan)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="passport-btn"
                style={{ flex: 1, padding: '8px', fontSize: '0.8rem', background: '#ef4444' }}
                onClick={cancelDrawing}
              >
                Cancel
              </button>
              <button
                className="passport-btn"
                style={{ flex: 1.5, padding: '8px', fontSize: '0.85rem' }}
                onClick={saveCustomBoundary}
                disabled={saving}
              >
                <Check size={16} /> {saving ? 'Submitting...' : role === 'village_officer' ? '📩 Issue Change Request' : '✅ Approve & Commit'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Legend Overlay */}
      <div className="map-legend">
        <div className="legend-title">GIS Land Use & Zoning Legend</div>
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#3b82f6', border: '2px solid #1d4ed8' }}></div>
            <span>🏡 Residential Area</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#eab308', border: '2px solid #d97706' }}></div>
            <span>🌾 Agricultural Area</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#ea580c', border: '2px solid #c2410c' }}></div>
            <span>🏭 Industrial Area</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#a855f7', border: '2px solid #8b5cf6' }}></div>
            <span>🌿 Ecological / Forest Zone</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ background: '#06b6d4', border: '2px solid #0f766e' }}></div>
            <span>🚗 Transport / Commercial</span>
          </div>
          <div className="legend-item" style={{ marginTop: '4px', borderTop: '1px solid #e2e8f0', paddingTop: '4px' }}>
            <div className="legend-color" style={{ background: '#ef4444', border: '2px dashed #b91c1c' }}></div>
            <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠️ Overlapping Zone (Caution - Red)</span>
          </div>
        </div>
      </div>

      {/* Approval Queue Modal */}
      {showApprovalModal && (
        <ApprovalQueueModal
          role={role}
          onClose={() => setShowApprovalModal(false)}
          onRequestProcessed={(approvedUlpin) => {
            loadMapData();
            fetchPendingCount();
            if (approvedUlpin && onSelectParcel) {
              onSelectParcel(approvedUlpin);
            }
          }}
        />
      )}
    </div>
  );
}
