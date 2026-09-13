import React, { useState } from 'react';
import { X, Cpu, AlertTriangle, ShieldAlert, Layers, CheckCircle2, RefreshCw, Eye, Download } from 'lucide-react';

export default function SatelliteAiChangeDetectionModal({ ulpin, state, onClose }) {
  const [selectedModel, setSelectedModel] = useState('UNET_RESNET34_MULTI_SPECTRAL');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState({
    confidence: 94.2,
    anomaly_detected: true,
    anomaly_type: 'UNAUTHORIZED_STRUCTURE_IN_ECO_ZONE',
    encroachment_area_sqm: 142.5,
    sentinel_date_pre: '2023-11-15',
    sentinel_date_post: '2026-08-28',
    spectral_ndvi_delta: -0.42,
    threat_level: 'HIGH_PRIORITY_AUDIT'
  });

  const handleRunAiAnalysis = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      setScanResult(prev => ({
        ...prev,
        confidence: Math.round((92 + Math.random() * 6) * 10) / 10,
        encroachment_area_sqm: Math.round((120 + Math.random() * 40) * 10) / 10
      }));
    }, 1200);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content glass-card" style={{ maxWidth: '900px', width: '94vw', padding: '1.75rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={22} color="#a855f7" /> AI Satellite Change-Detection & Encroachment Engine
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.825rem', margin: '0.25rem 0 0' }}>
              Sentinel-2 & Planet Labs multi-spectral AI change detection for ULPIN: <strong style={{ color: '#cbd5e1' }}>{ulpin || 'TN-CHN-0042-1187'}</strong>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Control Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(15, 23, 42, 0.7)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.25rem', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>AI Detection Model:</span>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              style={{ background: '#0f172a', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}
            >
              <option value="UNET_RESNET34_MULTI_SPECTRAL">U-Net ResNet34 Multi-Spectral (Sentinel-2)</option>
              <option value="YOLO_SATELLITE_BUILDING">YOLO-v8 Satellite Building Extractor</option>
              <option value="NDVI_VEGETATION_INDEX">NDVI Vegetation Index Delta Detector</option>
            </select>
          </div>
          <button
            onClick={handleRunAiAnalysis}
            disabled={isScanning}
            className="btn-primary"
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#9333ea', border: 'none' }}
          >
            <RefreshCw size={14} className={isScanning ? 'spin' : ''} />
            {isScanning ? 'Running Satellite AI Inference...' : 'Re-Run AI Inference'}
          </button>
        </div>

        {/* Dual Satellite Image Comparison Panel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          {/* Pre-period Imagery */}
          <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8' }}>Sentinel-2 Baseline ({scanResult.sentinel_date_pre})</span>
              <span style={{ fontSize: '0.7rem', color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Clear Land</span>
            </div>
            <div style={{
              height: '190px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #052e16 0%, #14532d 50%, #064e3b 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed rgba(34, 197, 94, 0.4)',
              position: 'relative'
            }}>
              <Layers size={36} color="#4ade80" style={{ opacity: 0.6 }} />
              <span style={{ color: '#86efac', fontSize: '0.75rem', marginTop: '0.5rem', fontWeight: 500 }}>Vegetation Cover (NDVI: 0.68)</span>
              <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>No Structures Detected</span>
            </div>
          </div>

          {/* Post-period Imagery with AI Heatmap Overlay */}
          <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f8fafc' }}>Planet Labs Current ({scanResult.sentinel_date_post})</span>
              <span style={{ fontSize: '0.7rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.2)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 600 }}>Anomaly Triggered</span>
            </div>
            <div style={{
              height: '190px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 50%, #1e1b4b 100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid #ef4444',
              position: 'relative'
            }}>
              <AlertTriangle size={36} color="#f87171" />
              <span style={{ color: '#fca5a5', fontSize: '0.75rem', marginTop: '0.5rem', fontWeight: 600 }}>AI Heatmap Overlay: Delta {scanResult.encroachment_area_sqm} m²</span>
              <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>Unauthorized Structure Detected</span>
            </div>
          </div>
        </div>

        {/* AI Inference Analysis Report */}
        <div style={{ background: 'rgba(147, 51, 234, 0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(147, 51, 234, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e9d5ff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ShieldAlert size={16} color="#c084fc" /> AI Computer Vision Analysis Diagnostics
            </span>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#c084fc', background: 'rgba(192, 132, 252, 0.15)', padding: '0.2rem 0.6rem', borderRadius: '12px' }}>
              AI Confidence: {scanResult.confidence}%
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', fontSize: '0.775rem', color: '#cbd5e1', marginTop: '0.75rem' }}>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Anomaly Category</div>
              <div style={{ color: '#f87171', fontWeight: 600, marginTop: '0.1rem' }}>Unauthorized Eco-Zone Structure</div>
            </div>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Encroachment Footprint</div>
              <div style={{ color: '#f8fafc', fontWeight: 600, marginTop: '0.1rem' }}>{scanResult.encroachment_area_sqm} m²</div>
            </div>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>NDVI Canopy Change</div>
              <div style={{ color: '#fbbf24', fontWeight: 600, marginTop: '0.1rem' }}>{scanResult.spectral_ndvi_delta} (Vegetation Loss)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
