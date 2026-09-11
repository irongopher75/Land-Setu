import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Polygon, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { PlusCircle, Edit3, Check, X, MapPin, Sparkles, Search } from 'lucide-react';
import { getParcelsGeoJSON, getProtectedZonesGeoJSON, createCustomParcel, identifyStateByCoords } from '../api';

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

export default function MapView({ selectedState, onSelectParcel, selectedUlpin, editingParcel, onClearEditingParcel, onAutoDetectState }) {
  const [parcelsGeoJSON, setParcelsGeoJSON] = useState(null);
  const [protectedGeoJSON, setProtectedGeoJSON] = useState(null);

  // Auto-detected state info
  const [detectedStateInfo, setDetectedStateInfo] = useState({ label: 'Tamil Nadu', name: 'TamilNadu', capital: 'Chennai' });

  // Custom Interactive Boundary Drawer state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [vertices, setVertices] = useState([]);
  const [reshapeError, setReshapeError] = useState('');
  const [customUlpin, setCustomUlpin] = useState('');
  const [customOwner, setCustomOwner] = useState('');
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

  useEffect(() => {
    loadMapData();
  }, [selectedState]);

  // Load existing parcel coordinates when user clicks "Reshape Boundary" from ParcelPanel
  useEffect(() => {
    if (editingParcel && editingParcel.geometry && editingParcel.geometry.coordinates) {
      const coords = editingParcel.geometry.coordinates[0];
      const leafletCoords = coords.slice(0, -1).map(([lng, lat]) => [lat, lng]);
      setVertices(leafletCoords);
      setCustomUlpin(editingParcel.ulpin);
      setCustomOwner(editingParcel.layers?.ror?.owner_name || 'Parcel Owner');
      setIsDrawingMode(true);
    }
  }, [editingParcel]);

  const loadMapData = async () => {
    try {
      const [parcelsData, zonesData] = await Promise.all([
        SHOW_SEEDED_PARCELS ? getParcelsGeoJSON(selectedState) : Promise.resolve(null),
        getProtectedZonesGeoJSON(selectedState),
      ]);
      setParcelsGeoJSON(parcelsData);
      setProtectedGeoJSON(zonesData);
    } catch (err) {
      console.error('Failed to load map GeoJSON layers:', err);
    }
  };

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

    const statePrefix = (detectedStateInfo.code || 'GIS') + '-MANUAL';
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setCustomUlpin(`${statePrefix}-${randomNum}`);
    setCustomOwner('Citizen / Custom Owner');
    setVertices(initialRing);
    setReshapeError('');
    setIsDrawingMode(true);
  };

  const cancelDrawing = () => {
    setIsDrawingMode(false);
    setVertices([]);
    setReshapeError('');
    if (onClearEditingParcel) onClearEditingParcel();
  };

  // Add vertex handle at exact clicked position on map
  const handleMapClickPosition = (latlng) => {
    setVertices((prev) => [...prev, latlng]);
  };

  // Drag handle update
  const handleVertexDrag = (index, event) => {
    const { lat, lng } = event.target.getLatLng();
    setVertices((prev) => {
      const updated = [...prev];
      updated[index] = [lat, lng];
      return updated;
    });
  };

  // Save boundary changes & re-run spatial rules engine
  const saveCustomBoundary = async () => {
    if (vertices.length < 3) return;
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
        geometry: geojsonPolygon,
        area_sqm: areaSqm
      });

      if (onAutoDetectState && targetState !== selectedState) {
        onAutoDetectState(targetState);
      }

      await loadMapData();
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
    const hasFlags = feature.properties?.has_flags;

    if (isSelected) {
      return {
        fillColor: '#3b82f6',
        fillOpacity: 0.65,
        color: '#60a5fa',
        weight: 3,
        dashArray: ''
      };
    }

    if (hasFlags) {
      return {
        fillColor: '#ef4444',
        fillOpacity: 0.35,
        color: '#f87171',
        weight: 2,
        dashArray: ''
      };
    }

    return {
      fillColor: '#10b981',
      fillOpacity: 0.35,
      color: '#34d399',
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

    const tooltipContent = `
      <div style="font-family: sans-serif; font-size: 12px;">
        <strong style="color: #3b82f6;">ULPIN: ${props.ulpin}</strong><br/>
        Status: <span style="color: ${props.has_flags ? '#ef4444' : '#10b981'}; font-weight: bold;">
          ${props.has_flags ? `⚠️ Flagged (${props.flag_count} rules)` : '✅ Clean'}
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
          e.target.setStyle({ fillOpacity: 0.75, weight: 3 });
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
        {SHOW_SEEDED_PARCELS && parcelsGeoJSON && (
          <GeoJSON
            key={`parcels-${selectedState}`}
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
                color: '#06b6d4',
                fillColor: '#06b6d4',
                fillOpacity: 0.5,
                weight: 3,
                dashArray: '4, 4'
              }}
            />
            {vertices.map((pos, idx) => (
              <Marker
                key={idx}
                position={pos}
                icon={handleIcon}
                draggable={true}
                eventHandlers={{
                  drag: (e) => handleVertexDrag(idx, e)
                }}
              />
            ))}
          </>
        )}
      </MapContainer>

      {/* Top Map Action Bar & Auto State Detection Pill */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 900, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Real-Time Auto-Identified Location Pill */}
        <div style={{ background: 'var(--bg-card)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-card)', padding: '8px 14px', borderRadius: '20px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          <MapPin size={14} color="var(--accent-cyan)" />
          <span>Auto-Identified State: <strong style={{ color: 'var(--accent-cyan)' }}>{detectedStateInfo.label || detectedStateInfo.name}</strong> ({detectedStateInfo.capital})</span>
          <span style={{ fontSize: '0.7rem', background: 'rgba(16,185,129,0.2)', color: '#34d399', padding: '2px 6px', borderRadius: '10px', fontWeight: 700 }}>
            AUTO SPATIAL
          </span>
        </div>

        {!isDrawingMode ? (
          <button className="passport-btn" style={{ width: 'auto', padding: '10px 18px', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }} onClick={startDrawing}>
            <Edit3 size={16} /> Draw / Reshape Boundary
          </button>
        ) : (
          <div style={{ background: 'var(--bg-card)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-card)', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px', width: '330px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>📐 Boundary Reshaper ({vertices.length} Handles)</span>
              <button onClick={cancelDrawing} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', background: 'rgba(6,182,212,0.1)', padding: '8px', borderRadius: '6px', border: '1px solid rgba(6,182,212,0.2)' }}>
              💡 Drag blue handles OR click anywhere on map to add vertex points at your exact current resolution!
            </div>

            <div style={{ fontSize: '0.85rem', background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '8px' }}>
              Computed Area: <strong style={{ color: '#4ade80' }}>{currentArea} sqm</strong>
            </div>

            {reshapeError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171', padding: '8px 10px', borderRadius: '6px', fontSize: '0.78rem', lineHeight: 1.4 }}>
                {reshapeError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                value={customUlpin}
                onChange={(e) => setCustomUlpin(e.target.value)}
                placeholder="Target ULPIN"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-card)', color: '#fff', padding: '6px 10px', borderRadius: '6px', fontSize: '0.82rem' }}
              />
              <input
                type="text"
                value={customOwner}
                onChange={(e) => setCustomOwner(e.target.value)}
                placeholder="Owner Name"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-card)', color: '#fff', padding: '6px 10px', borderRadius: '6px', fontSize: '0.82rem' }}
              />
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
                <Check size={16} /> {saving ? 'Evaluating...' : 'Save & Evaluate'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Legend Overlay */}
      <div className="map-legend">
        <div className="legend-title">GIS Layer Legend</div>
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-color color-clean"></div>
            <span>Clean Parcel</span>
          </div>
          <div className="legend-item">
            <div className="legend-color color-flagged"></div>
            <span>Rule Flagged Parcel (Overlap/FSI)</span>
          </div>
          <div className="legend-item">
            <div className="legend-color color-protected"></div>
            <span>Protected Eco-Sensitive Zone</span>
          </div>
        </div>
      </div>
    </div>
  );
}
