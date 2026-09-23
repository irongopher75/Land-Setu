import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { X } from 'lucide-react';
import { requestSplit, requestMerge } from '../api';

const CUT_OVERSHOOT_M = 100; // extend the cut line so a click inside each edge still cuts through

function extendLine(points) {
  const first = turf.point(points[0]);
  const second = turf.point(points[1]);
  const last = turf.point(points[points.length - 1]);
  const beforeLast = turf.point(points[points.length - 2]);
  const head = turf.destination(first, CUT_OVERSHOOT_M, turf.bearing(second, first), { units: 'meters' }).geometry.coordinates;
  const tail = turf.destination(last, CUT_OVERSHOOT_M, turf.bearing(beforeLast, last), { units: 'meters' }).geometry.coordinates;
  return [head, ...points, tail];
}

function computeSplit(parcelGeometry, cutPoints) {
  if (cutPoints.length < 2) return { parts: null, message: 'Click two or more points to draw the cut line across the parcel.' };
  const poly = turf.feature(parcelGeometry);
  const line = turf.lineString(extendLine(cutPoints));
  const blade = turf.buffer(line, 0.02, { units: 'meters' });
  const diff = turf.difference(turf.featureCollection([poly, blade]));
  if (!diff || diff.geometry.type !== 'MultiPolygon' || diff.geometry.coordinates.length !== 2) {
    return { parts: null, message: 'The cut line must cross the parcel from edge to edge and leave exactly two parts.' };
  }
  const parts = diff.geometry.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
  return { parts, message: null };
}

function computeMerge(parcelGeometry, otherGeometry) {
  const merged = turf.union(turf.featureCollection([turf.feature(parcelGeometry), turf.feature(otherGeometry)]));
  if (!merged || merged.geometry.type !== 'Polygon') {
    return { merged: null, message: 'These parcels do not share a boundary, so they cannot be merged.' };
  }
  return { merged: merged.geometry, message: null };
}

export default function RestructurePanel({ map, mode, parcel, clickRef, parcelClickRef, onClose, onSubmitted }) {
  const [cutPoints, setCutPoints] = useState([]);
  const [other, setOther] = useState(null); // { ulpin, geometry }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const layerRef = useRef(null);

  useEffect(() => {
    layerRef.current = L.layerGroup().addTo(map);
    clickRef.current = mode === 'split' ? ([lat, lng]) => setCutPoints((p) => [...p, [lng, lat]]) : null;
    parcelClickRef.current = mode === 'merge'
      ? (feature) => {
        if (feature.properties.ulpin === parcel.ulpin) return;
        setOther({ ulpin: feature.properties.ulpin, geometry: feature.geometry });
      }
      : null;
    return () => {
      clickRef.current = null;
      parcelClickRef.current = null;
      layerRef.current.remove();
    };
  }, [map, mode, parcel.ulpin]);

  const split = useMemo(() => (mode === 'split' ? computeSplit(parcel.geometry, cutPoints) : null), [mode, parcel, cutPoints]);
  const merge = useMemo(() => (mode === 'merge' && other ? computeMerge(parcel.geometry, other.geometry) : null), [mode, parcel, other]);

  useEffect(() => {
    const g = layerRef.current;
    if (!g) return;
    g.clearLayers();
    if (mode === 'split') {
      if (cutPoints.length > 0) L.polyline(cutPoints.map(([lng, lat]) => [lat, lng]), { color: '#A63D2F', weight: 2, dashArray: '2 6' }).addTo(g);
      split?.parts?.forEach((part, i) => {
        L.geoJSON(part, { style: { color: '#1B2A41', weight: 3, fillOpacity: 0.12, dashArray: i === 0 ? null : '8 5' } })
          .bindTooltip(`Part ${i + 1}: ${Math.round(turf.area(turf.feature(part)))} sq m`, { permanent: true, direction: 'center', className: 'restructure-label' })
          .addTo(g);
      });
    } else if (other) {
      L.geoJSON(other.geometry, { style: { color: '#A63D2F', weight: 3, fillOpacity: 0.1, dashArray: '8 5' } }).addTo(g);
    }
  }, [mode, cutPoints, split, other]);

  const ready = mode === 'split' ? !!split?.parts : !!merge?.merged;
  const hint = mode === 'split' ? split?.message : other ? merge?.message : `Click the parcel you want to merge with ${parcel.ulpin}.`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = mode === 'split'
        ? await requestSplit(parcel.ulpin, split.parts, reason || 'Parcel split')
        : await requestMerge(parcel.ulpin, other.ulpin, reason || 'Parcel merge');
      onSubmitted(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const area = mode === 'merge' && merge?.merged ? Math.round(turf.area(turf.feature(merge.merged))) : null;

  return (
    <div className="restructure-panel" role="region" aria-label={mode === 'split' ? 'Split parcel' : 'Merge parcels'}>
      <div className="modal-head">
        <div>
          <h3>{mode === 'split' ? 'Split' : 'Merge'} <span className="data-id">{parcel.ulpin}</span></h3>
          <p>{mode === 'split'
            ? 'Draw a cut line across the parcel. The two parts keep this ULPIN as a prefix.'
            : 'Pick an adjacent parcel with the same recorded owner.'}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Cancel"><X size={18} /></button>
      </div>

      {other && mode === 'merge' && <div className="wf-current"><span>Merging with</span><strong className="data-id">{other.ulpin}</strong></div>}
      {area !== null && <div className="wf-current"><span>Combined area</span><strong className="tabular">{area} sq m</strong></div>}
      {hint && <div className="note">{hint}</div>}
      {error && <div className="note note note--alert" role="alert">{error}</div>}

      <label className="wf-form-inline">Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Sale of a portion, partition deed, consolidation" />
      </label>

      <div className="wf-actions">
        {mode === 'split' && <button className="btn" onClick={() => setCutPoints((p) => p.slice(0, -1))} disabled={cutPoints.length === 0}>Undo point</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" onClick={submit} disabled={!ready || busy}>
          {busy ? 'Submitting' : `Submit ${mode} request`}
        </button>
      </div>
    </div>
  );
}
