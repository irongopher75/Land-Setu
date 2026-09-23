import React, { useState } from 'react';
import { X, Cpu, AlertTriangle, ShieldAlert, Layers, RefreshCw } from 'lucide-react';

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--xwide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3 className="title-row"><Cpu size={20} aria-hidden="true" /> Satellite change detection</h3>
            <p>Before and after imagery for ULPIN <span className="data-id">{ulpin || 'TN-CHN-0042-1187'}</span>. Demo output, not a live model run.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="toolbar">
          <label>Detection model
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
              <option value="UNET_RESNET34_MULTI_SPECTRAL">U-Net ResNet34 multi-spectral (Sentinel-2)</option>
              <option value="YOLO_SATELLITE_BUILDING">YOLO-v8 building extractor</option>
              <option value="NDVI_VEGETATION_INDEX">NDVI vegetation delta</option>
            </select>
          </label>
          <button onClick={handleRunAiAnalysis} disabled={isScanning} className="btn btn--primary btn--auto">
            <RefreshCw size={14} className={isScanning ? 'spin' : ''} aria-hidden="true" />
            {isScanning ? 'Running' : 'Run again'}
          </button>
        </div>

        <div className="field-row">
          <div className="stack--tight stack">
            <div className="row row--between">
              <span className="pane-title">Baseline <span className="tabular">{scanResult.sentinel_date_pre}</span></span>
              <span className="badge verified">Clear land</span>
            </div>
            <div className="imagery imagery--clear">
              <Layers size={32} aria-hidden="true" />
              <span>Vegetation cover, NDVI 0.68</span>
              <span className="subtle">No structures detected</span>
            </div>
          </div>

          <div className="stack--tight stack">
            <div className="row row--between">
              <span className="pane-title">Current <span className="tabular">{scanResult.sentinel_date_post}</span></span>
              <span className="badge stale">Anomaly flagged</span>
            </div>
            <div className="imagery imagery--flagged">
              <AlertTriangle size={32} aria-hidden="true" />
              <span>Change area <span className="tabular">{scanResult.encroachment_area_sqm} m²</span></span>
              <span className="subtle">Unauthorized structure detected</span>
            </div>
          </div>
        </div>

        <div className="stack--tight stack">
          <div className="row row--between">
            <span className="pane-title"><ShieldAlert size={16} aria-hidden="true" /> Analysis</span>
            <span className="badge self_declared tabular">Confidence {scanResult.confidence}%</span>
          </div>
          <dl className="stat-strip">
            <div><dt>Anomaly</dt><dd className="is-alert stat-text">Unauthorized eco-zone structure</dd></div>
            <div><dt>Footprint</dt><dd>{scanResult.encroachment_area_sqm} <small>m²</small></dd></div>
            <div><dt>NDVI change</dt><dd>{scanResult.spectral_ndvi_delta} <small>vegetation loss</small></dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}
