import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import { PlusCircle, Edit3, Check, X, ShieldAlert, Layers } from 'lucide-react';
import { getParcelsGeoJSON, getProtectedZonesGeoJSON, createCustomParcel } from '../api';

// Draggable Vertex Handle Icon
const handleIcon = L.divIcon({
  className: 'custom-vertex-marker',
  html: '<div style="width: 16px; height: 16px; background: #06b6d4; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 12px rgba(6,182,212,0.9); cursor: move;"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// Helper component to center map when state selection changes
function MapFocusHandler({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2 });
  }, [center, zoom, map]);
  return null;
}

// Area calculation helper (meters squared)
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

export default function MapView({ selectedState, onSelectParcel, selectedUlpin }) {
  const [parcelsGeoJSON, setParcelsGeoJSON] = useState(null);
  const [protectedGeoJSON, setProtectedGeoJSON] = useState(null);

  // Custom Interactive Boundary Drawer state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [vertices, setVertices] = useState([]);
  const [customUlpin, setCustomUlpin] = useState('');
  const [customOwner, setCustomOwner] = useState('');
  const [saving, setSaving] = useState(false);

  const stateCenters = {
    TamilNadu: { center: [13.084, 80.274], zoom: 15 },
    Chandigarh: { center: [30.735, 76.778], zoom: 15 }
  };

  const currentFocus = stateCenters[selectedState] || stateCenters.TamilNadu;

  useEffect(() => {
    loadMapData();
  }, [selectedState]);

  const loadMapData = async () => {
    try {
      const [parcelsData, zonesData] = await Promise.all([
        getParcelsGeoJSON(selectedState),
        getProtectedZonesGeoJSON(selectedState)
      ]);
      setParcelsGeoJSON(parcelsData);
      setProtectedGeoJSON(zonesData);
    } catch (err) {
      console.error('Failed to load map GeoJSON layers:', err);
    }
  };

  // Start manual boundary drawing mode (places circle ring of 6 draggable handles)
  const startDrawing = () => {
    const [centerLat, centerLng] = currentFocus.center;
    const numPoints = 6;
    const radius = 0.0008; // ~90 meters radius circle
    const initialRing = [];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i * 2 * Math.PI) / numPoints;
      const lat = centerLat + radius * Math.cos(angle);
      const lng = centerLng + (radius * Math.sin(angle)) / Math.cos((centerLat * Math.PI) / 180);
      initialRing.push([lat, lng]);
    }

    const statePrefix = selectedState === 'TamilNadu' ? 'TN-CHN-MANUAL' : 'CHD-SEC-MANUAL';
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setCustomUlpin(`${statePrefix}-${randomNum}`);
    setCustomOwner('Citizen / Custom Owner');
    setVertices(initialRing);
    setIsDrawingMode(true);
  };

  const cancelDrawing = () => {
    setIsDrawingMode(false);
    setVertices([]);
  };

  // Update vertex handle position on drag
  const handleVertexDrag = (index, event) => {
    const { lat, lng } = event.target.getLatLng();
    const updated = [...vertices];
    updated[index] = [lat, lng];
    setVertices(updated);
  };

  // Add new vertex point
  const addVertex = () => {
    if (vertices.length < 3) return;
    const p1 = vertices[0];
    const p2 = vertices[1];
    const midLat = (p1[0] + p2[0]) / 2;
    const midLng = (p1[1] + p2[1]) / 2;
    setVertices([[midLat, midLng], ...vertices]);
  };

  // Save drawn polygon boundary to platform & run spatial rules engine
  const saveCustomBoundary = async () => {
    if (vertices.length < 3) return;
    setSaving(true);

    // Close polygon ring in GeoJSON format ([lng, lat])
    const geojsonCoordinates = vertices.map(([lat, lng]) => [lng, lat]);
    geojsonCoordinates.push([vertices[0][1], vertices[0][0]]);

    const geojsonPolygon = {
      type: 'Polygon',
      coordinates: [geojsonCoordinates]
    };

    const areaSqm = calculatePolygonAreaSqm(vertices);

    try {
      const result = await createCustomParcel({
        ulpin: customUlpin,
        state: selectedState,
        owner_name: customOwner,
        geometry: geojsonPolygon,
        area_sqm: areaSqm
      });

      // Reload map data and open drawer for new parcel
      await loadMapData();
      setIsDrawingMode(false);
      onSelectParcel(result.ulpin);
    } catch (err) {
      console.error('Failed to save boundary:', err);
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
        Owner: <strong>${props.ror_owner || 'N/A'}</strong><br/>
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
        center={currentFocus.center}
        zoom={currentFocus.zoom}
        scrollWheelZoom={true}
        zoomControl={false}
      >
        <MapFocusHandler center={currentFocus.center} zoom={currentFocus.zoom} />

        {/* CartoDB Dark Tiles with API Key */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_3gmv_1_ce82e9ddc32b820ba54c3a97"
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
            key={`parcels-${selectedState}`}
            data={parcelsGeoJSON}
            style={getParcelStyle}
            onEachFeature={onEachParcel}
          />
        )}

        {/* Interactive Custom Boundary Drawer Layer */}
        {isDrawingMode && (
          <>
            <Polygon
              positions={vertices}
              pathOptions={{
                color: '#06b6d4',
                fillColor: '#06b6d4',
                fillOpacity: 0.45,
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

      {/* Top Map Action Bar */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 900, display: 'flex', gap: '10px' }}>
        {!isDrawingMode ? (
          <button className="passport-btn" style={{ width: 'auto', padding: '10px 18px', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }} onClick={startDrawing}>
            <Edit3 size={16} /> Draw Custom Boundary Handles
          </button>
        ) : (
          <div style={{ background: 'var(--bg-card)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-card)', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px', width: '320px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>📐 Interactive Boundary Editor</span>
              <span style={{ fontSize: '0.75rem', background: 'rgba(6,182,212,0.2)', color: '#38bdf8', padding: '2px 8px', borderRadius: '8px' }}>
                {vertices.length} Vertices
              </span>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Drag the circular blue handles around on the map to adjust each boundary edge.
            </div>

            <div style={{ fontSize: '0.85rem', background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '8px' }}>
              Computed Area: <strong style={{ color: '#4ade80' }}>{currentArea} sqm</strong>
            </div>

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

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                className="passport-btn"
                style={{ flex: 1, padding: '8px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border-card)' }}
                onClick={addVertex}
              >
                <PlusCircle size={14} /> Add Handle
              </button>
              <button
                className="passport-btn"
                style={{ flex: 1, padding: '8px', fontSize: '0.8rem', background: '#ef4444' }}
                onClick={cancelDrawing}
              >
                <X size={14} /> Cancel
              </button>
            </div>

            <button
              className="passport-btn"
              style={{ width: '100%', padding: '10px', fontSize: '0.85rem' }}
              onClick={saveCustomBoundary}
              disabled={saving}
            >
              <Check size={16} /> {saving ? 'Evaluating Rules...' : 'Save & Run Rule Engine'}
            </button>
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
