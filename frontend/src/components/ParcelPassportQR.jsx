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
          <div className="stat-line"><span>State</span><span>{payload?.state}</span></div>
          <div className="stat-line"><span>Rule checks</span><span>{payload?.is_verified ? 'No rule flags at issue time' : 'One or more rule flags at issue time'}</span></div>
          <div className="stat-line"><span>Issued by</span><span>LandSetu records service, valid 5 minutes</span></div>
          <div className="stat-line">
            <span>Audit log</span>
            <span className="tabular">
              {passportData.block_height != null
                ? `${passportData.block_height} ${passportData.block_height === 1 ? 'entry' : 'entries'}, ${passportData.ledger_verified ? 'hashes verified by the server' : 'altered: verification failed'}`
                : 'Not reachable, so not shown'}
            </span>
          </div>
        </div>

        <div className="raw-record">
          <strong>Audit log head hash</strong><br />
          {passportData.block_hash || 'Not available'}<br /><br />
          <strong>Signed token</strong><br />
          {signed_token}
        </div>

        <button className="btn btn--primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
