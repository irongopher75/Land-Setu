import React, { useState, useEffect } from 'react';
import { ArrowRight, Play, Cpu, CheckCircle2, Layers } from 'lucide-react';
import { getRawSamples, previewAdapter } from '../api';

export default function AdapterDemo() {
  const [samples, setSamples] = useState({ TamilNadu: [], Chandigarh: [] });
  const [state, setState] = useState('TamilNadu');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rawRecord, setRawRecord] = useState(null);
  const [canonicalOutput, setCanonicalOutput] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSamples();
  }, []);

  useEffect(() => {
    if (samples[state] && samples[state].length > 0) {
      setSelectedIndex(0);
      const initialRecord = samples[state][0];
      setRawRecord(initialRecord);
      runAdapterPreview(state, initialRecord);
    }
  }, [state, samples]);

  const fetchSamples = async () => {
    try {
      const data = await getRawSamples();
      setSamples(data);
    } catch (err) {
      console.error('Failed to load raw sample records:', err);
    }
  };

  const handleRecordChange = (index) => {
    setSelectedIndex(index);
    const rec = samples[state][index];
    setRawRecord(rec);
    runAdapterPreview(state, rec);
  };

  const runAdapterPreview = async (currentState, record) => {
    if (!record) return;
    setLoading(true);
    try {
      const res = await previewAdapter(currentState, record);
      setCanonicalOutput(res.canonical);
    } catch (err) {
      console.error('Adapter preview failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentRecords = samples[state] || [];

  return (
    <div className="adapter-demo-container">
      <div>
        <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '1.6rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Cpu color="var(--accent-cyan)" /> Generic Config-Driven Schema Adapter Engine
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
          Demonstrating zero-code schema normalization: Different state raw formats (Tamil Nadu CSV & Chandigarh CSV) map into the identical canonical schema using declarative YAML rules.
        </p>
      </div>

      {/* Controls Bar */}
      <div style={{ display: 'flex', gap: '16px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-card)', alignItems: 'center' }}>
        <div className="state-selector">
          <span>Target State:</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="TamilNadu">Tamil Nadu (TN_RoR_v3 Config)</option>
            <option value="Chandigarh">Chandigarh (CHD_Jamabandi_v2 Config)</option>
          </select>
        </div>

        <div className="state-selector">
          <span>Select Raw Record:</span>
          <select value={selectedIndex} onChange={(e) => handleRecordChange(Number(e.target.value))}>
            {currentRecords.map((r, i) => (
              <option key={i} value={i}>
                Record #{i + 1}: {r.ulpin} ({r.pattadar_peyar || r.owner_full_name})
              </option>
            ))}
          </select>
        </div>

        <button
          className="passport-btn"
          style={{ width: 'auto', padding: '8px 20px' }}
          onClick={() => runAdapterPreview(state, rawRecord)}
        >
          <Play size={16} /> Execute Adapter Preview
        </button>
      </div>

      {/* Side-by-Side Comparison */}
      <div className="sandbox-grid">
        {/* Left Box: Raw Record Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Layers size={16} /> Raw State Record Input ({state})
          </div>
          <pre className="code-box">
            {rawRecord ? JSON.stringify(rawRecord, null, 2) : 'Select a record...'}
          </pre>
        </div>

        {/* Right Box: Live Normalized Canonical JSON */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={16} /> Live Normalized Canonical Schema Output
          </div>
          <pre className="code-box" style={{ color: '#4ade80' }}>
            {loading ? 'Running Schema Adapter...' : canonicalOutput ? JSON.stringify(canonicalOutput, null, 2) : 'No output'}
          </pre>
        </div>
      </div>
      <footer style={{ padding: '24px', textAlign: 'center', borderTop: '1px solid #cbd5e1', color: 'var(--accent-primary)', fontSize: '0.82rem', fontWeight: 700, marginTop: '24px' }}>
        Made by Vishnu Panicker
      </footer>
    </div>
  );
}
