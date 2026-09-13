import React, { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { PlusCircle, Edit3, Check, X, MapPin, Sparkles, Search, Lock, Navigation, Target, ClipboardList, AlertTriangle } from 'lucide-react';
import { getParcelsGeoJSON, getProtectedZonesGeoJSON, createCustomParcel, identifyStateByCoords, getPendingRequests, getApprovedCustomParcels, requestParcelDeletion, deleteParcelDirectly, getDeletedUlpins } from '../api';
import ApprovalQueueModal from './ApprovalQueueModal';

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

// Geometry parser helper
const ensureTurfFeature = (f) => {
  if (!f) return null;
  let geom = f.geometry;
  if (typeof geom === 'string') {
    try { geom = JSON.parse(geom); } catch (e) {}
  }
  if (!geom || !geom.type || !geom.coordinates) return null;
  return turf.feature(geom, f.properties || {});
};

// Turf v7 overlap area calculation helper
const calculateFeatureOverlapArea = (polyA, polyB) => {
  try {
    const featA = ensureTurfFeature(polyA);
    const featB = ensureTurfFeature(polyB);
    if (!featA || !featB) return 0;
    const fc = turf.featureCollection([featA, featB]);
    const intersection = turf.intersect(fc);
    if (intersection) {
      const areaSqm = turf.area(intersection);
      if (areaSqm > 0.05) return areaSqm;
    }
  } catch (err1) {
    try {
      const featA = ensureTurfFeature(polyA);
      const featB = ensureTurfFeature(polyB);
      if (featA && featB && turf.booleanIntersects(featA, featB)) {
        return 1.0;
      }
    } catch (err2) {}
  }
  return 0;
};

// Spatial Overlap Detection Helper using Turf
const evaluateParcelsOverlap = (featureCollection, protectedZones) => {
  if (!featureCollection || !featureCollection.features) return featureCollection;

  const features = featureCollection.features.map(f => {
    const existingFlags = f.properties?.flags || [];
    const hasRuleOverlap = existingFlags.some(fl => fl.rule === 'boundary_overlap' || fl.rule === 'protected_zone');

    return {
      ...f,
      properties: {
        ...f.properties,
        has_overlap: Boolean(hasRuleOverlap || f.properties?.has_overlap),
        overlapping_with: f.properties?.overlapping_with || [],
        overlap_reasons: f.properties?.overlap_reasons || []
      }
    };
  });

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      try {
        const polyA = features[i];
        const polyB = features[j];
        const overlapAreaSqm = calculateFeatureOverlapArea(polyA, polyB);
        if (overlapAreaSqm > 0.05) {
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
      } catch (err) {
        console.warn('Overlap computation notice:', err);
      }
    }

    if (protectedZones && protectedZones.features) {
      for (const zone of protectedZones.features) {
        try {
          const overlapAreaSqm = calculateFeatureOverlapArea(features[i], zone);
          if (overlapAreaSqm > 0.05) {
            const zoneName = zone.properties?.name || 'Protected Eco Zone';
            features[i].properties.has_overlap = true;
            features[i].properties.has_flags = true;
            if (!features[i].properties.overlapping_with.includes(zoneName)) {
              features[i].properties.overlapping_with.push(zoneName);
              features[i].properties.overlap_reasons.push(`Overlaps with Protected Zone: ${zoneName}`);
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

  // Pure Native Leaflet Map Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const parcelsLayerRef = useRef(null);
  const protectedLayerRef = useRef(null);
  const drawingLayerRef = useRef(null);
  const userLocLayerRef = useRef(null);

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

  const getParcelStyle = (feature) => {
    const isSelected = feature.properties?.ulpin === selectedUlpin;
    const isApproved = feature.properties?.is_approved || feature.properties?.status === 'APPROVED';
    const hasFlags = feature.properties?.has_flags;
    const hasOverlap = feature.properties?.has_overlap;
    const landUse = feature.properties?.land_use || feature.properties?.zone_category || feature.properties?.layers?.zoning?.land_use || 'residential';
    const theme = getLandUseTheme(landUse);

    if (hasOverlap) {
      return {
        fillColor: '#ef4444',
        fillOpacity: isSelected ? 0.85 : 0.65,
        color: '#b91c1c',
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

  // 1. Initialize Pure Leaflet Map EXACTLY ONCE on mount
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Prevent re-initialization error if map instance or _leaflet_id already exists
    if (mapInstanceRef.current || mapContainerRef.current._leaflet_id) {
      return;
    }

    const map = L.map(mapContainerRef.current, {
      center: currentFocus.center,
      zoom: currentFocus.zoom,
      scrollWheelZoom: true,
      zoomControl: false
    });

    mapInstanceRef.current = map;

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_3gmv_1_ce82e9ddc32b820ba54c3a97',
      {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }
    ).addTo(map);

    parcelsLayerRef.current = L.layerGroup().addTo(map);
    protectedLayerRef.current = L.layerGroup().addTo(map);
    drawingLayerRef.current = L.layerGroup().addTo(map);
    userLocLayerRef.current = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      const c = map.getCenter();
      handleMapMoveEnd(c.lat, c.lng);
    });

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.off();
          mapInstanceRef.current.remove();
        } catch (e) {}
        mapInstanceRef.current = null;
      }
      if (mapContainerRef.current) {
        try {
          delete mapContainerRef.current._leaflet_id;
        } catch (e) {}
      }
    };
  }, []); // RUNS ONCE ON MOUNT!

  // Update map click handler dynamically for drawing mode
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const onMapClick = (e) => {
      if (isDrawingMode) {
        handleMapClickPosition([e.latlng.lat, e.latlng.lng]);
      }
    };

    map.off('click');
    map.on('click', onMapClick);
  }, [isDrawingMode]);

  // Fly map on state change
  useEffect(() => {
    if (mapInstanceRef.current && selectedState) {
      const map = mapInstanceRef.current;
      const cCenter = map.getCenter();
      const dist = Math.hypot(cCenter.lat - currentFocus.center[0], cCenter.lng - currentFocus.center[1]);
      if (dist > 1.5) {
        map.flyTo(currentFocus.center, currentFocus.zoom, { duration: 1.2 });
      }
    }
  }, [selectedState]);

  // Render Protected GeoJSON layer
  useEffect(() => {
    if (!protectedLayerRef.current) return;
    protectedLayerRef.current.clearLayers();
    if (protectedGeoJSON) {
      const geoLayer = L.geoJSON(protectedGeoJSON, {
        style: {
          fillColor: '#a855f7',
          fillOpacity: 0.25,
          color: '#c084fc',
          weight: 2,
          dashArray: '6, 6'
        },
        onEachFeature: (feat, layer) => {
          layer.bindTooltip(`🛡️ ${feat.properties.name}`, { sticky: true });
        }
      });
      protectedLayerRef.current.addLayer(geoLayer);
    }
  }, [protectedGeoJSON]);

  // Render Parcels GeoJSON layer
  useEffect(() => {
    if (!parcelsLayerRef.current) return;
    parcelsLayerRef.current.clearLayers();
    if (parcelsGeoJSON) {
      const geoLayer = L.geoJSON(parcelsGeoJSON, {
        style: getParcelStyle,
        onEachFeature: (feature, layer) => {
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

          const popupContent = `
            <div style="font-family: sans-serif; font-size: 13px; padding: 4px; min-width: 210px;">
              <strong style="color: #1d4ed8; font-size: 14px;">ULPIN: ${props.ulpin}</strong><br/>
              <div style="margin: 4px 0 8px 0; color: #334155; font-size: 12px;">
                ${props.owner_name ? `Owner: <strong>${props.owner_name}</strong><br/>` : ''}
                Zoning: <strong>${theme.label}</strong>
              </div>
              ${role === 'state_admin' ? `
                <button
                  onclick="if(window.LandSetuDeleteParcel) window.LandSetuDeleteParcel('${props.ulpin}')"
                  style="width: 100%; background: linear-gradient(135deg, #ef4444, #b91c1c); color: #ffffff; border: none; padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer;"
                >
                  📩 Request Land Deletion
                </button>
              ` : ''}
            </div>
          `;

          layer.bindTooltip(tooltipContent, { sticky: true, className: 'custom-map-tooltip' });
          layer.bindPopup(popupContent);

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
            mouseout: () => {
              layer.setStyle(getParcelStyle(feature));
            }
          });
        }
      });
      parcelsLayerRef.current.addLayer(geoLayer);
    }
  }, [parcelsGeoJSON, selectedUlpin, role, isDrawingMode]);

  // Global Governance Deletion Handler for Leaflet Popups
  useEffect(() => {
    window.LandSetuDeleteParcel = async (ulpinToDelete) => {
      if (role !== 'state_admin') {
        alert('🔒 Permission Denied: Only State Administration Officers can initiate land deletion requests.');
        return;
      }
      const confirmed = window.confirm(
        `⚠️ Are you sure you want to initiate land deletion for ULPIN '${ulpinToDelete}'?\n\nThis will submit a deletion request into the Governance Approval Pipeline.\n\nFlow:\n1. State Admin Initiates Request (Done)\n2. Village Land Officer Approves (Stage 1)\n3. Compliance Auditor Authorizes (Stage 2)`
      );
      if (!confirmed) return;
      try {
        const res = await requestParcelDeletion(ulpinToDelete, 'Initiated from GIS Map');
        alert(`📩 ${res.message}`);
        await loadMapData();
        fetchPendingCount();
      } catch (err) {
        alert(err.response?.data?.detail || err.message || 'Failed to submit land deletion request.');
      }
    };
    return () => {
      delete window.LandSetuDeleteParcel;
    };
  }, [onSelectParcel, role]);

  // Locate user GPS position
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

        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo(coords, 15, { duration: 1.5 });
        }

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

  useEffect(() => {
    fetchPendingCount();
    const onPipeline = () => fetchPendingCount();
    window.addEventListener('landsetu-pipeline-updated', onPipeline);
    return () => window.removeEventListener('landsetu-pipeline-updated', onPipeline);
  }, []);

  const loadMapData = async () => {
    try {
      const [parcelsData, zonesData, customParcels, deletedUlpins] = await Promise.all([
        getParcelsGeoJSON(selectedState),
        getProtectedZonesGeoJSON(selectedState),
        getApprovedCustomParcels(),
        getDeletedUlpins()
      ]);

      const deletedSet = new Set(deletedUlpins || []);
      const normalizeStateKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

      const customFeatures = Object.values(customParcels || {})
        .filter(p => {
          if (!p || !p.geometry) return false;
          if (deletedSet.has(p.ulpin)) return false;
          if (!p.state) return true;
          return normalizeStateKey(p.state) === normalizeStateKey(selectedState);
        })
        .map(p => ({
          type: 'Feature',
          properties: {
            ulpin: p.ulpin,
            state: p.state || selectedState,
            area_sqm: p.area_sqm,
            owner_name: p.layers?.ror?.owner_name || 'Land Owner',
            land_use: p.land_use || p.layers?.zoning?.land_use || 'residential',
            is_approved: true,
            status: 'APPROVED',
            has_flags: p.flags && p.flags.length > 0
          },
          geometry: p.geometry
        }));

      let mergedParcels = parcelsData || { type: 'FeatureCollection', features: [] };
      mergedParcels = {
        ...mergedParcels,
        features: (mergedParcels.features || []).filter((f) => !deletedSet.has(f.properties?.ulpin))
      };
      if (customFeatures.length > 0) {
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

  useEffect(() => {
    loadMapData();
    fetchPendingCount();
  }, [selectedState, role]);

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

  const handleMapClickPosition = (latLng) => {
    if (!isDrawingMode) return;
    setVertices((prev) => [...prev, latLng]);
  };

  const handleMapMoveEnd = async (lat, lng) => {
    try {
      const info = await identifyStateByCoords(lat, lng);
      if (info && info.name) {
        setDetectedStateInfo(info);
      }
    } catch (err) {}
  };

  const handleVertexDrag = (index, newLat, newLng) => {
    setVertices((prev) => {
      const updated = [...prev];
      updated[index] = [newLat, newLng];
      return updated;
    });
  };

  // Render Drawing Layer
  const isDrawingOverlapping = false;

  useEffect(() => {
    if (!drawingLayerRef.current) return;
    drawingLayerRef.current.clearLayers();
    if (isDrawingMode && vertices && vertices.length > 0) {
      const theme = getLandUseTheme(selectedLandUse);
      const poly = L.polygon(vertices, {
        color: isDrawingOverlapping ? '#b91c1c' : theme.border,
        fillColor: isDrawingOverlapping ? '#ef4444' : theme.fill,
        fillOpacity: isDrawingOverlapping ? 0.75 : 0.55,
        weight: isDrawingOverlapping ? 4.5 : 3,
        dashArray: '6, 6'
      });
      drawingLayerRef.current.addLayer(poly);

      vertices.forEach((pos, idx) => {
        const marker = L.marker(pos, { icon: handleIcon, draggable: true });
        marker.on('drag', (e) => {
          const latLng = e.target.getLatLng();
          handleVertexDrag(idx, latLng.lat, latLng.lng);
        });
        drawingLayerRef.current.addLayer(marker);
      });
    }
  }, [isDrawingMode, vertices, selectedLandUse]);

  // Render User Location Layer
  useEffect(() => {
    if (!userLocLayerRef.current) return;
    userLocLayerRef.current.clearLayers();
    if (userLocation) {
      const marker = L.marker(userLocation, { icon: userLocationIcon });
      userLocLayerRef.current.addLayer(marker);
    }
  }, [userLocation]);

  const saveCustomBoundary = async () => {
    if (vertices.length < 3) {
      setReshapeError('A parcel polygon requires at least 3 vertex points.');
      return;
    }
    setSaving(true);
    setReshapeError('');

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

  const currentArea = calculatePolygonAreaSqm(vertices);

  return (
    <div className="map-view-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Pure Native Leaflet Map Mount Container */}
      <div
        ref={mapContainerRef}
        className="leaflet-dom-map-host"
        style={{ width: '100%', height: '100%', zIndex: 1 }}
      />

      {/* Top Map Action Bar & Auto State Detection Pill */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 900, display: 'flex', flexDirection: 'column', gap: '10px' }} className="map-toolbar">
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '8px 14px', borderRadius: '20px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#0f172a', boxShadow: '0 4px 16px rgba(15,23,42,0.1)' }}>
            <MapPin size={14} color="var(--accent-primary)" />
            <span>Auto-Identified State: <strong style={{ color: 'var(--accent-primary)' }}>{detectedStateInfo.label || detectedStateInfo.name}</strong> ({detectedStateInfo.capital})</span>
            <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '10px', fontWeight: 700 }}>
              AUTO SPATIAL
            </span>
          </div>

          <button
            onClick={() => locateUserAndCenter(false)}
            disabled={locating}
            style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', padding: '8px 14px', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 16px rgba(15,23,42,0.1)' }}
          >
            <Target size={14} color="#3b82f6" /> {locating ? 'Locating GPS...' : 'My GPS Location'}
          </button>

          {(role === 'auditor' || role === 'state_admin' || role === 'village_officer') && (
            <button
              onClick={() => setShowApprovalModal(true)}
              style={{
                background: pendingCount > 0 ? 'linear-gradient(135deg, #eab308, #ca8a04)' : '#ffffff',
                border: pendingCount > 0 ? 'none' : '1px solid #cbd5e1',
                color: pendingCount > 0 ? '#ffffff' : '#0f172a',
                padding: '8px 14px',
                borderRadius: '20px',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 16px rgba(15,23,42,0.1)'
              }}
            >
              <ClipboardList size={14} color={pendingCount > 0 ? '#ffffff' : '#eab308'} />
              Governance Queue {pendingCount > 0 && <span style={{ background: '#ef4444', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '0.72rem' }}>{pendingCount}</span>}
            </button>
          )}
        </div>

        {locationError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: '6px 12px', borderRadius: '8px', fontSize: '0.78rem' }}>
            {locationError}
          </div>
        )}
      </div>

      {/* Floating Action Button: Add / Reshape Boundary */}
      {!isDrawingMode && (
        <div style={{ position: 'absolute', bottom: 30, right: 30, zIndex: 900 }}>
          {role !== 'citizen' ? (
            <button
              className="fab-btn"
              onClick={() => {
                setVertices([]);
                setCustomUlpin(`ULPIN-${selectedState.substring(0,2).toUpperCase()}-${Date.now().toString().slice(-4)}`);
                setCustomOwner('New Land Owner');
                setIsDrawingMode(true);
              }}
              style={{
                background: 'linear-gradient(135deg, #2563eb, #06b6d4)',
                color: '#fff',
                border: 'none',
                padding: '14px 22px',
                borderRadius: '30px',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(37, 99, 235, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <PlusCircle size={20} /> Mark Custom Land Boundary
            </button>
          ) : (
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid var(--border-card)',
                color: 'var(--text-muted)',
                padding: '10px 16px',
                borderRadius: '20px',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backdropFilter: 'blur(8px)'
              }}
            >
              <Lock size={14} color="#38bdf8" /> Citizen Access (Read-Only GIS Map)
            </div>
          )}
        </div>
      )}

      {/* Interactive Boundary Reshaper Control Panel */}
      {isDrawingMode && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 990,
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '16px',
            padding: '16px 20px',
            width: '90%',
            maxWidth: '560px',
            boxShadow: '0 12px 36px rgba(15,23,42,0.2)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Edit3 size={18} color="var(--accent-primary)" />
              <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>Vector Boundary Editor ({selectedState})</strong>
            </div>
            <button
              onClick={() => {
                setIsDrawingMode(false);
                setVertices([]);
                setReshapeError('');
                if (onClearEditingParcel) onClearEditingParcel();
              }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>ULPIN Identifier</label>
              <input
                type="text"
                value={customUlpin}
                onChange={(e) => setCustomUlpin(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#f8fafc', color: '#0f172a' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>Owner Name</label>
              <input
                type="text"
                value={customOwner}
                onChange={(e) => setCustomOwner(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#f8fafc', color: '#0f172a' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f1f5f9', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.8rem', color: '#334155' }}>Vertices: <strong>{vertices.length} points</strong></span>
            <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 700 }}>Calculated Area: {currentArea} sqm</span>
          </div>

          {reshapeError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', marginBottom: '12px' }}>
              {reshapeError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setVertices((prev) => prev.slice(0, -1))}
              disabled={vertices.length === 0}
              style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', fontWeight: 600, fontSize: '0.82rem', cursor: vertices.length === 0 ? 'not-allowed' : 'pointer' }}
            >
              Undo Point
            </button>

            <button
              onClick={saveCustomBoundary}
              disabled={saving || vertices.length < 3}
              style={{ flex: 1.5, padding: '8px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#ffffff', fontWeight: 700, fontSize: '0.85rem', cursor: (saving || vertices.length < 3) ? 'not-allowed' : 'pointer', opacity: (saving || vertices.length < 3) ? 0.6 : 1 }}
            >
              {saving ? 'Evaluating Rules...' : 'Submit Boundary Change'}
            </button>
          </div>
        </div>
      )}

      {/* Approval Governance Queue Modal */}
      {showApprovalModal && (
        <ApprovalQueueModal
          onClose={() => setShowApprovalModal(false)}
          role={role}
          onApproved={async () => {
            await loadMapData();
            fetchPendingCount();
          }}
        />
      )}
    </div>
  );
}
