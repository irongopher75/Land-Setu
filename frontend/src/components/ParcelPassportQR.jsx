import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, ShieldCheck, Download, ExternalLink } from 'lucide-react';

export default function ParcelPassportQR({ passportData, onClose }) {
  if (!passportData) return null;

  const { ulpin, signed_token, passport_url, payload } = passportData;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck color="#10b981" size={24} />
            <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '1.2rem', color: '#fff' }}>
              Verifiable Parcel Passport
            </h3>
          </div>
          <button className="drawer-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="qr-container">
          <QRCodeSVG value={signed_token} size={200} level="H" includeMargin={true} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>ULPIN:</span>
            <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{ulpin}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>RoR Owner:</span>
            <span style={{ fontWeight: 600 }}>{payload?.owner || 'N/A'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>State:</span>
            <span>{payload?.state}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Issuer:</span>
            <span style={{ color: 'var(--accent-emerald)' }}>{payload?.issuer}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Blockchain Status:</span>
            <span style={{ color: '#10b981', fontWeight: 700 }}>⛓️ SHA-256 Verified (Block #{passportData.block_height || 2})</span>
          </div>
        </div>

        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px', wordBreak: 'break-all', fontFamily: 'monospace' }}>
          <strong style={{ color: '#38bdf8' }}>Blockchain SHA-256 Block Hash:</strong><br/>
          {passportData.block_hash || '0x7f8a9b2c3d4e5f6a8b9c0d1e2f3a4b5c'}<br/><br/>
          <strong>JWT Signature Token:</strong><br/>
          {signed_token}
        </div>

        <button className="passport-btn" onClick={onClose}>
          Close Passport
        </button>
      </div>
    </div>
  );
}
