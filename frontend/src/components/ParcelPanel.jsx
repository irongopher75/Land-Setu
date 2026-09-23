import React, { useState, useEffect, lazy, Suspense } from 'react';
import { X, QrCode, Lock, Trash2, Cpu } from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';
import FlagDiff from './FlagDiff';
import ParcelTimeline from './ParcelTimeline';
import { getParcelDetail, getParcelPassport, requestParcelDeletion } from '../api';

const ParcelPassportQR = lazy(() => import('./ParcelPassportQR'));
const BlockchainExplorerModal = lazy(() => import('./BlockchainExplorerModal'));

const RESTRUCTURE_ROLES = ['village_officer', 'officer', 'state_admin'];

function Field({ label, value, mono, tone }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="field-item">
      <span className="field-label">{label}</span>
      <span className={`field-value ${mono ? 'data-id' : ''} ${tone ? `is-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

function Layer({ title, layer, children }) {
  return (
    <section className="layer-section">
      <div className="layer-section-title">
        <span>{title}</span>
        <ConfidenceBadge confidence={layer?.confidence} />
      </div>
      <div className="field-grid">{children}</div>
    </section>
  );
}

const NA = 'Not recorded';

export default function ParcelPanel({ ulpin, onClose, role, onReshapeBoundary, onDeletionRequested, onStartRestructure, onRequestCorrection }) {
  const [parcel, setParcel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passportData, setPassportData] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showBlockchain, setShowBlockchain] = useState(false);
  const [tab, setTab] = useState('record'); // 'record' | 'history'

  useEffect(() => {
    if (!ulpin) return;
    setTab('record');
    setLoading(true);
    getParcelDetail(ulpin)
      .then(setParcel)
      .catch((err) => console.error('Failed to fetch parcel detail:', err))
      .finally(() => setLoading(false));
  }, [ulpin, role]);

  const handlePassportClick = async () => {
    try {
      setPassportData(await getParcelPassport(ulpin));
      setShowQR(true);
    } catch (err) {
      console.error('Failed to fetch passport:', err);
    }
  };

  const handleRequestDeletion = async () => {
    if (!window.confirm(`Request deletion of ULPIN ${ulpin}?\n\nThe request goes to the village land officer, then to the auditor. The parcel is removed only after both approve.`)) return;
    setDeleting(true);
    try {
      const res = await requestParcelDeletion(ulpin, 'Initiated by State Admin Officer');
      alert(res.message);
      if (onDeletionRequested) onDeletionRequested(ulpin);
      onClose();
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to submit land deletion request.');
    } finally {
      setDeleting(false);
    }
  };

  if (!ulpin) return null;

  const L = parcel?.layers || {};
  const flags = parcel?.flags || [];

  return (
    <>
      <aside className="parcel-drawer" aria-label={`Parcel ${ulpin}`}>
        <div className="drawer-header">
          <div>
            <div className="drawer-ulpin">{ulpin}</div>
            <div className="drawer-meta">
              {parcel?.state || NA} · <span className="tabular">{parcel?.area_sqm ? `${parcel.area_sqm} sq m` : NA}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close parcel panel"><X size={18} /></button>
        </div>

        <div className="drawer-body">
          {loading ? (
            <div className="drawer-loading">Loading the record for {ulpin}</div>
          ) : (
            <>
              <div className="btn-row">
                <button className="btn" onClick={handlePassportClick}><QrCode size={15} /> QR passport</button>
                {role !== 'citizen' ? (
                  <button className="btn" onClick={() => onReshapeBoundary && onReshapeBoundary(parcel)}>Reshape boundary</button>
                ) : (
                  <button className="btn" disabled title="Citizens have read-only access."><Lock size={14} /> Read only</button>
                )}
                {role === 'state_admin' && (
                  <button className="btn btn--seal" onClick={handleRequestDeletion} disabled={deleting} title="Needs approval from the village land officer and the auditor.">
                    <Trash2 size={15} /> {deleting ? 'Submitting' : 'Request deletion'}
                  </button>
                )}
              </div>

              {RESTRUCTURE_ROLES.includes(role) && parcel?.geometry && (
                <div className="btn-row">
                  <button className="btn" onClick={() => onStartRestructure('split', parcel)}>Split parcel</button>
                  <button className="btn" onClick={() => onStartRestructure('merge', parcel)}>Merge with neighbour</button>
                </div>
              )}
              <div className="btn-row">
                <button className="btn" onClick={onRequestCorrection}>Request a record correction</button>
              </div>

              <div className="panel-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'record'} className={tab === 'record' ? 'is-active' : ''} onClick={() => setTab('record')}>Record</button>
                <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}>History</button>
              </div>

              {tab === 'history' ? (
                <ParcelTimeline ulpin={ulpin} />
              ) : (
                <>
                  <div className="ledger-block">
                    <div className="ledger-block-head">
                      <span>Title hash chain</span>
                      <span className="badge verified">Tamper evident</span>
                    </div>
                    <div className="note">Each change to this parcel is chained with SHA-256 and stored in Firestore.</div>
                    <button className="btn btn--block" onClick={() => setShowBlockchain(true)}><Cpu size={15} /> Audit hash chain</button>
                  </div>

                  {flags.length > 0 && (
                    <div className="flags-card">
                      <div className="flags-title">Flags on this parcel ({flags.length})</div>
                      {flags.map((flag, idx) => <FlagDiff key={idx} flag={flag} layers={L} />)}
                    </div>
                  )}

                  <Layer title="Record of Rights" layer={L.ror}>
                    <Field label="Owner name" value={L.ror?.owner_name || NA} />
                    <Field label="Khata or patta no." value={L.ror?.khata_no || NA} mono />
                    <Field label="Ownership share" value={L.ror?.owner_share} />
                    <Field label="Source" value={L.ror?.source && String(L.ror.source).replace(/_/g, ' ')} />
                  </Layer>

                  <Layer title="Sub-Registrar transactions" layer={L.registration}>
                    <Field label="Deed reference" value={L.registration?.last_transaction_id || NA} mono />
                    <Field label="Deed date" value={L.registration?.date || NA} />
                    <Field label="Deed buyer" value={L.registration?.buyer_name} />
                    <Field label="Source" value={L.registration?.source && String(L.registration.source).replace(/_/g, ' ')} />
                  </Layer>

                  <Layer title="Master plan and zoning" layer={L.zoning}>
                    <Field label="Land use zone" value={L.zoning?.land_use || NA} />
                    <Field label="Permitted FSI" value={L.zoning?.permitted_fsi ?? NA} />
                  </Layer>

                  <Layer title="Building permits" layer={L.building_permit}>
                    <Field label="Permit status" value={L.building_permit?.status || NA} />
                    <Field label="Approved FSI" value={L.building_permit?.approved_fsi ?? NA} />
                    <Field label="Permit reference" value={L.building_permit?.permit_id || NA} mono />
                  </Layer>

                  <Layer title="Property tax" layer={L.tax}>
                    <Field label="Annual valuation" value={L.tax?.annual_value ? `Rs ${L.tax.annual_value.toLocaleString('en-IN')}` : NA} />
                    <Field label="Last verified" value={L.tax?.last_verified || NA} />
                  </Layer>

                  <Layer title="Financial encumbrances" layer={L.encumbrance}>
                    <Field
                      label="Active mortgage or lien"
                      value={L.encumbrance?.active ? 'Yes, active' : 'None on record'}
                      tone={L.encumbrance?.active ? 'alert' : 'verified'}
                    />
                  </Layer>

                  {parcel?.raw_record && (
                    <section className="layer-section">
                      <div className="layer-section-title"><span>Raw department record</span></div>
                      <pre className="raw-record">{JSON.stringify(parcel.raw_record, null, 2)}</pre>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </aside>

      {showQR && (
        <Suspense fallback={null}>
          <ParcelPassportQR passportData={passportData} onClose={() => setShowQR(false)} />
        </Suspense>
      )}
      {showBlockchain && (
        <Suspense fallback={null}>
          <BlockchainExplorerModal ulpin={ulpin} parcel={parcel} onClose={() => setShowBlockchain(false)} />
        </Suspense>
      )}
    </>
  );
}
