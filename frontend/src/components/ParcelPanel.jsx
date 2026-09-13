import React, { useState, useEffect } from 'react';
import { X, AlertOctagon, QrCode, FileText, CheckCircle, ShieldAlert, Layers, Lock, Trash2, Link2, ShieldCheck, Cpu } from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';
import ParcelPassportQR from './ParcelPassportQR';
import BlockchainExplorerModal from './BlockchainExplorerModal';
import { getParcelDetail, getParcelPassport, requestParcelDeletion, deleteParcelDirectly, getParcelBlockchain } from '../api';

export default function ParcelPanel({ ulpin, onClose, role, onReshapeBoundary, onDeletionRequested }) {
  const [parcel, setParcel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passportData, setPassportData] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showBlockchain, setShowBlockchain] = useState(false);
  const [latestBlockHash, setLatestBlockHash] = useState('0x7f8a9b2c3d4e5f6a');

  useEffect(() => {
    if (ulpin) {
      fetchParcelData();
    }
  }, [ulpin, role]);

  const fetchParcelData = async () => {
    setLoading(true);
    try {
      const data = await getParcelDetail(ulpin);
      setParcel(data);
    } catch (err) {
      console.error('Failed to fetch parcel detail:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePassportClick = async () => {
    try {
      const pData = await getParcelPassport(ulpin);
      setPassportData(pData);
      setShowQR(true);
    } catch (err) {
      console.error('Failed to fetch passport:', err);
    }
  };

  const handleRequestDeletion = async () => {
    if (!window.confirm(`⚠️ Are you sure you want to initiate land deletion for ULPIN '${ulpin}'?\n\nThis will submit a deletion request into the Governance Approval Pipeline.\n\nFlow:\n1. State Admin Initiates Request (Done)\n2. Village Land Officer Approves (Stage 1)\n3. Compliance Auditor Authorizes (Stage 2)`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await requestParcelDeletion(ulpin, 'Initiated by State Admin Officer');
      alert(`📩 ${res.message}`);
      if (onDeletionRequested) onDeletionRequested(ulpin);
      onClose();
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to submit land deletion request.');
    } finally {
      setDeleting(false);
    }
  };

  if (!ulpin) return null;

  const layers = parcel?.layers || {};
  const flags = parcel?.flags || [];

  return (
    <>
      <div className="parcel-drawer">
        <div className="drawer-header">
          <div>
            <div className="drawer-ulpin">
              <FileText color="var(--accent-primary)" size={20} />
              {ulpin}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              State: <strong style={{ color: '#0f172a' }}>{parcel?.state || 'N/A'}</strong> | Area: <strong style={{ color: '#0f172a' }}>{parcel?.area_sqm ? `${parcel.area_sqm} sqm` : 'N/A'}</strong>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          {loading ? (
            <div style={{ padding: '40px 0', textWrap: 'nowrap', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading unified parcel record...
            </div>
          ) : (
            <>
              {/* Passport Generation, Boundary Reshape & Deletion Request CTAs */}
              <div style={{ display: 'flex', gap: '8px', margin: '8px 0 16px 0', flexWrap: 'wrap' }}>
                <button className="passport-btn" style={{ flex: 1, padding: '9px 10px', fontSize: '0.8rem' }} onClick={handlePassportClick}>
                  <QrCode size={15} /> QR Passport
                </button>
                {role !== 'citizen' ? (
                  <button
                    className="passport-btn"
                    style={{ flex: 1.1, padding: '9px 10px', fontSize: '0.8rem', background: 'linear-gradient(135deg, #06b6d4, #2563eb)' }}
                    onClick={() => onReshapeBoundary && onReshapeBoundary(parcel)}
                  >
                    ✏️ Reshape
                  </button>
                ) : (
                  <button
                    className="passport-btn"
                    disabled
                    style={{ flex: 1.1, padding: '9px 10px', fontSize: '0.78rem', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-dim)', border: '1px solid var(--border-card)', cursor: 'not-allowed', opacity: 0.6 }}
                    title="Citizens have read-only access and cannot mark or reshape boundaries."
                  >
                    <Lock size={14} style={{ display: 'inline', marginRight: '4px' }} /> Read-Only
                  </button>
                )}

                {role === 'state_admin' && (
                <button
                  className="passport-btn"
                  style={{ flex: 1.2, padding: '9px 12px', fontSize: '0.8rem', background: 'linear-gradient(135deg, #ef4444, #b91c1c)', color: '#ffffff', fontWeight: 700, border: 'none' }}
                  onClick={handleRequestDeletion}
                  disabled={deleting}
                  title="State Admin can request deletion. Village Land Officer and Auditor must both approve before the parcel is removed."
                >
                  <Trash2 size={15} /> {deleting ? 'Submitting request...' : 'Request deletion'}
                </button>
                )}
              </div>

              {/* Immutable Blockchain Ledger Card */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.9))',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  margin: '12px 0 16px 0',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck color="#10b981" size={18} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>
                      ⛓️ SHA-256 Title Blockchain
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>
                    Tamper-Proof
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div>Proof Chain: <strong style={{ color: 'var(--accent-cyan)' }}>Google Cloud Firestore + Web Crypto SHA-256</strong></div>
                  <div>Latest Block Hash: <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>0x8f4a...92b1</span></div>
                </div>
                <button
                  style={{
                    width: '100%',
                    background: 'linear-gradient(135deg, #059669, #0d9488)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '7px',
                    padding: '8px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                  onClick={() => setShowBlockchain(true)}
                >
                  <Cpu size={15} /> Audit Blockchain Proof & Block History
                </button>
              </div>

              {/* Active Flags Section */}
              {flags.length > 0 && (
                <div className="flags-card">
                  <div className="flags-title">
                    <AlertOctagon size={18} /> Spatial & Data Violation Flags ({flags.length})
                  </div>
                  {flags.map((flag, idx) => (
                    <div key={idx} className="flag-box">
                      <div className="flag-rule">{flag.rule.replace(/_/g, ' ')}</div>
                      <div className="flag-reason">{flag.reason}</div>
                      {flag.evidence && (
                        <div className="flag-evidence">
                          {JSON.stringify(flag.evidence)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Department Layers */}

              {/* 1. Record of Rights (RoR) */}
              <div className="layer-section">
                <div className="layer-section-title">
                  <span>📜 Record of Rights (RoR)</span>
                  <ConfidenceBadge confidence={layers.ror?.confidence} />
                </div>
                <div className="field-grid">
                  <div className="field-item">
                    <span className="field-label">Owner Name</span>
                    <span className="field-value">{layers.ror?.owner_name || 'N/A'}</span>
                  </div>
                  <div className="field-item">
                    <span className="field-label">Khata / Patta No</span>
                    <span className="field-value">{layers.ror?.khata_no || 'N/A'}</span>
                  </div>
                  {layers.ror?.owner_share && (
                    <div className="field-item">
                      <span className="field-label">Ownership Share</span>
                      <span className="field-value">{layers.ror?.owner_share}</span>
                    </div>
                  )}
                  {layers.ror?.source && (
                    <div className="field-item">
                      <span className="field-label">Source Authority</span>
                      <span className="field-value">{layers.ror?.source}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Registration Layer */}
              <div className="layer-section">
                <div className="layer-section-title">
                  <span>🏢 Sub-Registrar Transactions</span>
                  <ConfidenceBadge confidence={layers.registration?.confidence} />
                </div>
                <div className="field-grid">
                  <div className="field-item">
                    <span className="field-label">Deed Ref ID</span>
                    <span className="field-value">{layers.registration?.last_transaction_id || 'N/A'}</span>
                  </div>
                  <div className="field-item">
                    <span className="field-label">Deed Date</span>
                    <span className="field-value">{layers.registration?.date || 'N/A'}</span>
                  </div>
                  {layers.registration?.buyer_name && (
                    <div className="field-item">
                      <span className="field-label">Deed Buyer Name</span>
                      <span className="field-value">{layers.registration?.buyer_name}</span>
                    </div>
                  )}
                  {layers.registration?.source && (
                    <div className="field-item">
                      <span className="field-label">Source Dept</span>
                      <span className="field-value">{layers.registration?.source}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Zoning Layer */}
              <div className="layer-section">
                <div className="layer-section-title">
                  <span>🗺️ Master Plan & Zoning</span>
                  <ConfidenceBadge confidence={layers.zoning?.confidence} />
                </div>
                <div className="field-grid">
                  <div className="field-item">
                    <span className="field-label">Land Use Zone</span>
                    <span className="field-value" style={{ textTransform: 'capitalize' }}>
                      {layers.zoning?.land_use || 'N/A'}
                    </span>
                  </div>
                  <div className="field-item">
                    <span className="field-label">Max Permitted FSI</span>
                    <span className="field-value">{layers.zoning?.permitted_fsi ?? 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* 4. Building Permit Layer */}
              <div className="layer-section">
                <div className="layer-section-title">
                  <span>🏗️ Building Permits</span>
                  <ConfidenceBadge confidence={layers.building_permit?.confidence} />
                </div>
                <div className="field-grid">
                  <div className="field-item">
                    <span className="field-label">Permit Status</span>
                    <span className="field-value" style={{ textTransform: 'capitalize' }}>
                      {layers.building_permit?.status || 'N/A'}
                    </span>
                  </div>
                  <div className="field-item">
                    <span className="field-label">Approved FSI</span>
                    <span className="field-value">{layers.building_permit?.approved_fsi ?? 'N/A'}</span>
                  </div>
                  <div className="field-item">
                    <span className="field-label">License / Permit Ref</span>
                    <span className="field-value">{layers.building_permit?.permit_id || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* 5. Revenue Tax Layer */}
              <div className="layer-section">
                <div className="layer-section-title">
                  <span>💰 Property Tax</span>
                  <ConfidenceBadge confidence={layers.tax?.confidence} />
                </div>
                <div className="field-grid">
                  <div className="field-item">
                    <span className="field-label">Annual Valuation</span>
                    <span className="field-value">
                      {layers.tax?.annual_value ? `₹${layers.tax.annual_value.toLocaleString()}` : 'N/A'}
                    </span>
                  </div>
                  <div className="field-item">
                    <span className="field-label">Last Verified Date</span>
                    <span className="field-value">{layers.tax?.last_verified || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* 6. Encumbrance Layer */}
              <div className="layer-section">
                <div className="layer-section-title">
                  <span>🔒 Financial Encumbrances</span>
                  <ConfidenceBadge confidence={layers.encumbrance?.confidence} />
                </div>
                <div className="field-grid">
                  <div className="field-item">
                    <span className="field-label">Active Mortgage/Lien</span>
                    <span className="field-value" style={{ color: layers.encumbrance?.active ? '#ef4444' : '#10b981' }}>
                      {layers.encumbrance?.active ? 'YES (Active Mortgage)' : 'Clean (No Lien)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Raw record audit view for officer / bank role */}
              {parcel?.raw_record && (
                <div className="layer-section">
                  <div className="layer-section-title">
                    <span>🔍 Raw Department Source Record</span>
                  </div>
                  <pre style={{ fontSize: '0.72rem', color: '#38bdf8', overflowX: 'auto', background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '8px' }}>
                    {JSON.stringify(parcel.raw_record, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showQR && (
        <ParcelPassportQR passportData={passportData} onClose={() => setShowQR(false)} />
      )}

      {showBlockchain && (
        <BlockchainExplorerModal ulpin={ulpin} parcel={parcel} onClose={() => setShowBlockchain(false)} />
      )}
    </>
  );
}
