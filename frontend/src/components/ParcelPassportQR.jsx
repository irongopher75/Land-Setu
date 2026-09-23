import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import { colors } from '../palette';

export default function ParcelPassportQR({ passportData, onClose }) {
  if (!passportData) return null;

  const { ulpin, signed_token, payload } = passportData;
  const c = colors();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Parcel passport" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Parcel passport</h3>
            <p>Scan to verify this record against the signed token.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="qr-container">
          <QRCodeSVG value={signed_token} size={200} level="H" includeMargin fgColor={c.ink} bgColor={c.surface} />
        </div>

        <div>
          <div className="stat-line"><span>ULPIN</span><span className="data-id">{ulpin}</span></div>
          <div className="stat-line"><span>Record of Rights owner</span><span>{payload?.owner || 'Not recorded'}</span></div>
          <div className="stat-line"><span>State</span><span>{payload?.state}</span></div>
          <div className="stat-line"><span>Issuer</span><span>{payload?.issuer}</span></div>
          <div className="stat-line"><span>Hash chain</span><span className="tabular">SHA-256, block {passportData.block_height || 2}</span></div>
        </div>

        <div className="raw-record">
          <strong>Block hash</strong><br />
          {passportData.block_hash || '0x7f8a9b2c3d4e5f6a8b9c0d1e2f3a4b5c'}<br /><br />
          <strong>Signed token</strong><br />
          {signed_token}
        </div>

        <button className="btn btn--primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
