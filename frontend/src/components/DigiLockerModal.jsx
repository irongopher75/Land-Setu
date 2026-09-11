import React from 'react';
import { X, ShieldCheck, Clock, ArrowRight, CheckCircle } from 'lucide-react';

export default function DigiLockerModal({ onClose, onProceedMock }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#1e40af', padding: '8px 12px', borderRadius: '8px', fontWeight: 800, color: '#fff', fontSize: '0.9rem', letterSpacing: '0.5px' }}>
              DigiLocker
            </div>
            <div>
              <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '1.1rem', color: '#fff' }}>
                National Identity Authentication
              </h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>MeitY | Govt. of India Integration</div>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#60a5fa', fontWeight: 700, fontSize: '0.9rem' }}>
            <Clock size={18} /> DigiLocker SSO Gateway — Coming Soon
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
            Native OAuth 2.0 integration with the official DigiLocker API (National e-Governance Division) for citizen Aadhaar and land record identity verification is currently undergoing sandbox security audit.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle size={14} color="#10b981" /> 256-bit Encrypted Government OAuth Token
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle size={14} color="#10b981" /> Automatic Citizen Property Extraction from e-District
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <button
            className="passport-btn"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border-card)', flex: 1 }}
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="passport-btn"
            style={{ flex: 1.5, background: 'linear-gradient(135deg, #1d4ed8, #0284c7)' }}
            onClick={onProceedMock}
          >
            Demo Login <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
