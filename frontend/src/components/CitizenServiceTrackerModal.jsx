import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getParcelDetail, getParcelHistory, requestCorrection } from '../api';

// Mirrors CORRECTABLE_FIELDS in backend/app/workflow.py.
const FIELDS = [
  { key: 'ror.owner_name', layer: 'ror', field: 'owner_name', label: 'Owner name (Record of Rights)' },
  { key: 'ror.khata_no', layer: 'ror', field: 'khata_no', label: 'Khata number (Record of Rights)' },
  { key: 'ror.owner_share', layer: 'ror', field: 'owner_share', label: 'Owner share (Record of Rights)' },
  { key: 'registration.buyer_name', layer: 'registration', field: 'buyer_name', label: 'Buyer name (Sub-Registrar deed)' },
  { key: 'zoning.land_use', layer: 'zoning', field: 'land_use', label: 'Land use (Zoning)' },
];

const STAGE_TEXT = {
  PENDING_VILLAGE_REVIEW: 'Waiting for the village land officer to verify your documents.',
  PENDING_APPROVAL: 'Verified by the village officer. Waiting for the auditor.',
  PENDING_STATE_ADMIN: 'Passed audit. Waiting for final approval by the state administrator.',
  PENDING_FAST_REVIEW: 'A spelling-level correction. One review by an auditor or the state administrator decides it.',
  APPROVED: 'Approved. The record has been corrected.',
  REJECTED: 'Rejected.',
};

export default function CitizenServiceTrackerModal({ initialUlpin, onClose }) {
  const [ulpin, setUlpin] = useState(initialUlpin || '');
  const [fieldKey, setFieldKey] = useState(FIELDS[0].key);
  const [requested, setRequested] = useState('');
  const [name, setName] = useState('');
  const [evidence, setEvidence] = useState('');
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [trail, setTrail] = useState([]);
  const [refId, setRefId] = useState('');

  const chosen = FIELDS.find((f) => f.key === fieldKey);

  // Requests already decided on this parcel. A new report can point at one; the old request is not reopened.
  const decided = Object.values(trail.reduce((acc, e) => {
    const m = /#(\d+):\s*(approved|archived|rejected)/i.exec(e.title || '');
    if (m) acc[m[1]] = { id: m[1], label: `${e.title.split('#')[0].trim()} ${m[2].toLowerCase()}` };
    return acc;
  }, {}));

  useEffect(() => {
    if (!ulpin) { setCurrent(null); setTrail([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      getParcelDetail(ulpin)
        .then((p) => live && setCurrent(p?.layers?.[chosen.layer]?.[chosen.field] ?? null))
        .catch(() => live && setCurrent(null));
      getParcelHistory(ulpin)
        .then((h) => live && setTrail(h.events.filter((e) => e.kind === 'request')))
        .catch(() => live && setTrail([]));
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [ulpin, fieldKey, result]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestCorrection(ulpin.trim(), {
        layer: chosen.layer, field: chosen.field, requestedValue: requested, evidence, requestedBy: name,
        referencesRequestId: refId ? Number(refId) : undefined,
      });
      setResult(res);
      setRequested('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Report an issue with this parcel">
      <div className="modal-card correction-card">
        <div className="modal-head">
          <div>
            <h3>Report an issue with this parcel</h3>
            <p>A spelling-level fix to a name or reference goes to one reviewer. Anything else goes to the village land officer, then the auditor, then the state administrator.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form className="wf-form" onSubmit={submit}>
          <label>ULPIN
            <input className="data-id" value={ulpin} onChange={(e) => setUlpin(e.target.value)} required />
          </label>
          <label>What is wrong
            <select value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
              {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <div className="wf-current">
            <span>Currently on record</span>
            <strong>{current === null ? 'Not recorded' : String(current)}</strong>
          </div>
          <label>Correct value
            <input value={requested} onChange={(e) => setRequested(e.target.value)} maxLength={200} required />
          </label>
          {decided.length > 0 && (
            <label>Is this about an earlier decision? (optional)
              <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">No, a new issue</option>
                {decided.map((d) => <option key={d.id} value={d.id}>Request #{d.id}: {d.label}</option>)}
              </select>
            </label>
          )}
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </label>
          <label>Supporting document (deed number, mutation order, notice)
            <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={3} maxLength={1000} />
          </label>

          {error && <div className="note note note--alert" role="alert">{error}</div>}
          {result && (
            <div className="note" role="status">
              Request #{result.request_id} filed. {STAGE_TEXT[result.status]}
            </div>
          )}
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Submitting' : 'Submit correction request'}</button>
        </form>

        {trail.length > 0 && (
          <div className="wf-trail">
            <h4>Requests on {ulpin}</h4>
            <ul>
              {[...trail].reverse().map((e, i) => (
                <li key={i}>
                  <span className="tabular">{e.date ? new Date(e.date).toLocaleDateString('en-IN') : ''}</span>
                  <span>{e.title}{e.detail ? `: ${e.detail}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
