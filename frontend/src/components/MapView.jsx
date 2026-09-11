import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import { getParcelsGeoJSON, getProtectedZonesGeoJSON } from '../api';

// Helper component to center map when state selection changes
function MapFocusHandler({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2 });
  }, [center, zoom, map]);
  return null;
}

export default function MapView({ selectedState, onSelectParcel, selectedUlpin }) {
  const [parcelsGeoJSON, setParcelsGeoJSON] = useState(null);
  const [protectedGeoJSON, setProtectedGeoJSON] = useState(null);
  const [loading, setLoading] = useState(true);

  // Default coordinate clusters
  const stateCenters = {
    TamilNadu: { center: [13.084, 80.274], zoom: 15 },
    Chandigarh: { center: [30.735, 76.778], zoom: 15 }
  };

  const currentFocus = stateCenters[selectedState] || stateCenters.TamilNadu;

  useEffect(() => {
    loadMapData();
  }, [selectedState]);

  const loadMapData = async () => {
    setLoading(true);
    try {
      const [parcelsData, zonesData] = await Promise.all([
        getParcelsGeoJSON(selectedState),
        getProtectedZonesGeoJSON(selectedState)
      ]);
      setParcelsGeoJSON(parcelsData);
      setProtectedGeoJSON(zonesData);
    } catch (err) {
      console.error('Failed to load map GeoJSON layers:', err);
    } finally {
      setLoading(false);
    }
  };

  // Parcel Styling
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

  // Protected Zone Styling
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
        onSelectParcel(props.ulpin);
      },
      mouseover: (e) => {
        e.target.setStyle({ fillOpacity: 0.75, weight: 3 });
      },
      mouseout: (e) => {
        layer.setStyle(getParcelStyle(feature));
      }
    });
  };

  return (
    <div className="map-view-container">
      <MapContainer
        center={currentFocus.center}
        zoom={currentFocus.zoom}
        scrollWheelZoom={true}
        zoomControl={false}
      >
        <MapFocusHandler center={currentFocus.center} zoom={currentFocus.zoom} />

        {/* CartoDB Dark Matter Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
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
      </MapContainer>

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
