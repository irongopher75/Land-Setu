import React, { useState } from 'react';

const TYPE_LABEL = { SPLIT: 'Split parcel', MERGE: 'Merge parcels', CORRECTION: 'Record correction', BOUNDARY: 'Boundary change', DELETION: 'Parcel archival' };

const STAGES = [
  { status: 'PENDING_VILLAGE_REVIEW', label: 'Village officer', actor: 'village_officer' },
  { status: 'PENDING_APPROVAL', label: 'Auditor', actor: 'auditor' },
  { status: 'PENDING_STATE_ADMIN', label: 'State admin', actor: 'state_admin' },
];

function Summary({ req }) {
  const p = req.payload || {};
  if (req.type === 'CORRECTION') {
    return (
      <div className="diff-pair">
        <div className="diff-side">
          <div className="diff-dept">On record</div>
          <div className="diff-label">{p.layer}.{p.field}</div>
          <div className="diff-value">{p.current ?? 'Not recorded'}</div>
        </div>
        <div className="diff-side">
          <div className="diff-dept">Requested</div>
          <div className="diff-label">{p.layer}.{p.field}</div>
          <div className="diff-value"><mark className="diff-mark">{p.requested}</mark></div>
          {p.evidence && <div className="diff-source">Evidence: {p.evidence}</div>}
        </div>
      </div>
    );
  }
  if (req.type === 'SPLIT') {
    return (
      <ul className="wf-summary">
        {(p.parts || []).map((part) => (
          <li key={part.ulpin}><span className="data-id">{part.ulpin}</span> <span className="tabular">{part.area_sqm} sq m</span></li>
        ))}
        <li>Original <span className="data-id">{req.ulpin}</span> is retired when approved.</li>
      </ul>
    );
  }
  if (req.type === 'BOUNDARY' || req.type === 'DELETION') {
    return (
      <ul className="wf-summary">
        <li>{req.type === 'DELETION' ? 'The parcel leaves the active map. Its record and history stay on file.' : 'A new or reshaped boundary for'} <span className="data-id">{req.ulpin}</span>.</li>
        {req.area_sqm ? <li className="tabular">{req.area_sqm} sq m</li> : null}
      </ul>
    );
  }
  return (
    <ul className="wf-summary">
      {(p.merge_ulpins || []).map((u, i) => (
        <li key={u}><span className="data-id">{u}</span> {i === 0 ? 'keeps this ULPIN' : 'is retired'}</li>
      ))}
    </ul>
  );
}


const STAGE_SETS = {
  fast: [['PENDING_FAST_REVIEW', 'Auditor or state admin']],
  deletion: [['PENDING_DELETION_VILLAGE', 'Village officer'], ['PENDING_DELETION_AUDITOR', 'Auditor']],
  boundary: [['PENDING_APPROVAL', 'Auditor'], ['PENDING_STATE_ADMIN', 'State admin']],
  full: [['PENDING_VILLAGE_REVIEW', 'Village officer'], ['PENDING_APPROVAL', 'Auditor'], ['PENDING_STATE_ADMIN', 'State admin']],
};
const LEGACY_AUDITOR = ['PENDING', 'PENDING_AUDITOR_REVIEW'];
const PASS_LABEL = {
  PENDING_VILLAGE_REVIEW: 'Verify and forward to auditor',
  PENDING_DELETION_VILLAGE: 'Approve and forward to auditor',
  PENDING_APPROVAL: 'Pass audit and forward to state admin',
  PENDING_DELETION_AUDITOR: 'Authorize archival',
  PENDING_STATE_ADMIN: 'Approve and apply',
  PENDING_FAST_REVIEW: 'Approve and apply the correction',
};
const ROLE_LABEL = { village_officer: 'village officer', auditor: 'auditor', state_admin: 'state admin', citizen: 'citizen', super_admin: 'super admin', officer: 'officer' };

function stageSet(req) {
  if (req.status === 'PENDING_FAST_REVIEW') return 'fast';
  if (req.type === 'DELETION') return 'deletion';
  return 'full';
}

function Concerns({ req, perms, on }) {
  const [note, setNote] = useState({});
  const flags = req.flags || [];
  const unresolved = flags.filter((f) => f.status !== 'resolved');
  const resolved = flags.filter((f) => f.status === 'resolved');
  if (flags.length === 0) return null;
  return (
    <div className={`concerns ${unresolved.length ? 'concerns--open' : ''}`} role={unresolved.length ? 'alert' : undefined}>
      {unresolved.length > 0 && (
        <strong>{unresolved.length === 1 ? 'An open concern' : `${unresolved.length} open concerns`} on this request{perms.can_resolve ? '. Resolve it or reject the request before you can approve.' : '.'}</strong>
      )}
      {unresolved.map((f) => (
        <div className="concern" key={f.id}>
          <div className="subtle">Raised by the {ROLE_LABEL[f.raised_by_role] || f.raised_by_role} while it was {String(f.stage_at_raise).replace(/_/g, ' ').toLowerCase()}. <span className="badge stale">{f.status}</span></div>
          <div>{f.reason}</div>
          {perms.can_resolve && !f.raised_by_you && (
            <div className="stack stack--tight">
              <textarea className="input" rows={2} maxLength={1000} placeholder="Note explaining why the concern is dismissed" value={note[f.id] || ''} onChange={(e) => setNote({ ...note, [f.id]: e.target.value })} aria-label="Resolution note" />
              <div className="btn-row">
                {f.status === 'open' && <button className="btn" onClick={() => on.acknowledge(f.id)}>Acknowledge</button>}
                <button className="btn btn--primary" disabled={(note[f.id] || '').trim().length < 5} onClick={() => on.resolve(f.id, note[f.id])}>Resolve with note</button>
              </div>
            </div>
          )}
          {f.raised_by_you && <div className="subtle">You raised this. Someone else must respond to it.</div>}
        </div>
      ))}
      {resolved.length > 0 && (
        <details>
          <summary className="subtle">{resolved.length} resolved</summary>
          {resolved.map((f) => (
            <div className="concern concern--resolved" key={f.id}>
              <div>{f.reason}</div>
              <div className="subtle">Resolved by the {ROLE_LABEL[f.resolved_by_role] || f.resolved_by_role}: {f.resolution_note}</div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

// Same limits the API enforces (backend/app/routes/parcels.py, validate_record_entry).
const ZONING_CHOICES = [
  ['residential', 'Residential'], ['commercial', 'Commercial'], ['industrial', 'Industrial'], ['agricultural', 'Agricultural'],
  ['institutional', 'Institutional'], ['mixed_use', 'Mixed use'], ['ecological', 'Ecological or forest'],
];
const TAX_MIN = 1;
const TAX_MAX = 10000000;
const OWNER_PLACEHOLDERS = ['tbd', 'na', 'n/a', 'none', 'null', 'unknown', 'nil', '-', '--', '0', 'test', 'xxx',
  'owner', 'land owner', 'new land owner', 'citizen / custom owner'];

function recordProblems(r) {
  const problems = {};
  const owner = r.owner_name.trim();
  if (!owner) problems.owner_name = 'Enter the owner\'s name.';
  else if (owner.length < 2 || owner.length > 160 || OWNER_PLACEHOLDERS.includes(owner.toLowerCase())) problems.owner_name = 'Enter the owner\'s actual name, not a placeholder.';
  if (!r.zoning) problems.zoning = 'Choose the zone.';
  const tax = r.tax_value === '' ? NaN : Number(r.tax_value);
  if (r.tax_value === '') problems.tax_value = 'Enter the annual tax value.';
  else if (!Number.isFinite(tax) || tax < TAX_MIN || tax > TAX_MAX) problems.tax_value = `Annual tax must be between Rs ${TAX_MIN} and Rs ${TAX_MAX.toLocaleString('en-IN')}.`;
  if (!r.encumbrance_status) problems.encumbrance_status = 'Choose the encumbrance status.';
  return problems;
}

// Approving a boundary for a ULPIN with no parcel creates the parcel. It has no department record, so the
// approving officer enters one. Every field starts empty: nothing can be submitted unedited.
function RecordEntryForm({ ulpin, onSubmit, onCancel }) {
  const [r, setR] = useState({ owner_name: '', zoning: '', tax_value: '', encumbrance_status: '' });
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const problems = recordProblems(r);
  const ready = Object.keys(problems).length === 0;
  const set = (k) => (e) => { setR({ ...r, [k]: e.target.value }); setTouched({ ...touched, [k]: true }); };
  const err = (k) => touched[k] && problems[k] ? <span className="field-error" role="alert">{problems[k]}</span> : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onSubmit({ owner_name: r.owner_name.trim(), zoning: r.zoning, tax_value: Number(r.tax_value), encumbrance_status: r.encumbrance_status });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack stack--tight record-entry" onSubmit={submit} noValidate>
      <p className="wf-request-meta">
        Approving creates parcel <span className="data-id">{ulpin}</span>, which has no department record yet. Enter its record.
        Each value is shown to the public as provided by the reviewing officer, not confirmed by the department.
      </p>
      <label className="field">Owner name
        <input className="input" type="text" autoComplete="off" maxLength={160} value={r.owner_name} onChange={set('owner_name')} aria-invalid={!!(touched.owner_name && problems.owner_name)} />
        {err('owner_name')}
      </label>
      <label className="field">Zone
        <select className="input" value={r.zoning} onChange={set('zoning')} aria-invalid={!!(touched.zoning && problems.zoning)}>
          <option value="" disabled>Choose</option>
          {ZONING_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {err('zoning')}
      </label>
      <label className="field">Annual property tax (Rs)
        <input className="input tabular" type="number" inputMode="decimal" min={TAX_MIN} max={TAX_MAX} step="0.01" value={r.tax_value} onChange={set('tax_value')} aria-invalid={!!(touched.tax_value && problems.tax_value)} />
        {err('tax_value')}
      </label>
      <fieldset className="field">
        <legend>Encumbrance</legend>
        <label><input type="radio" name={`enc-${ulpin}`} value="none" checked={r.encumbrance_status === 'none'} onChange={set('encumbrance_status')} /> None on record</label>
        <label><input type="radio" name={`enc-${ulpin}`} value="active" checked={r.encumbrance_status === 'active'} onChange={set('encumbrance_status')} /> Active mortgage or lien</label>
        {err('encumbrance_status')}
      </fieldset>
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={!ready || busy}>{busy ? 'Approving' : 'Approve and create parcel'}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {!ready && <p className="wf-request-meta">All four fields are required.</p>}
    </form>
  );
}

// Every button follows req.permissions, which the API computes with the same rules it enforces.
export default function WorkflowRequestCard({ req, on }) {
  const perms = req.permissions || {};
  const reasons = perms.reasons || {};
  const [raising, setRaising] = useState(false);
  const [reason, setReason] = useState('');
  const [enteringRecord, setEnteringRecord] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [remarks, setRemarks] = useState('');
  const set = STAGE_SETS[stageSet(req)];
  const status = LEGACY_AUDITOR.includes(req.status) ? 'PENDING_APPROVAL' : req.status;
  const activeIdx = set.findIndex(([st]) => st === status);
  const holder = perms.can_approve || perms.can_reject;
  const passHandler = {
    PENDING_VILLAGE_REVIEW: on.villagePass, PENDING_DELETION_VILLAGE: on.villageDelete, PENDING_APPROVAL: on.auditorPass,
    PENDING_DELETION_AUDITOR: on.auditorDelete, PENDING_STATE_ADMIN: on.approve, PENDING_FAST_REVIEW: on.fastApprove,
  }[status];
  const waitingOn = set[activeIdx]?.[1]?.toLowerCase() || 'a reviewer';
  // Final approval that creates a parcel first asks for its record.
  const needsRecord = status === 'PENDING_STATE_ADMIN' && req.needs_record_entry;

  return (
    <article className="wf-request">
      <header>
        <div>
          <span className="wf-request-type">{TYPE_LABEL[req.type] || req.type}</span>
          <span className="data-id">{req.ulpin}</span>
          {req.track === 'FAST' && <span className="badge self_declared">Fast track</span>}
        </div>
        <span className="wf-request-id tabular">Request #{req.id}</span>
      </header>

      <ol className={`wf-stages ${set.length === 2 ? 'wf-stages--two' : ''} ${set.length === 1 ? 'wf-stages--one' : ''}`} aria-label="Approval stages">
        <li className="is-done">Filed<small>done</small></li>
        {set.map(([st, label], i) => {
          const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'waiting';
          return <li key={st} className={`is-${state}`}>{label}<small>{state === 'done' ? 'passed' : state === 'active' ? 'current' : 'waiting'}</small></li>;
        })}
      </ol>

      <Summary req={req} />
      <p className="wf-request-meta">Filed by {req.requested_by} ({req.requester_role}). {req.reason}</p>

      <Concerns req={req} perms={perms} on={on} />

      <div className="wf-actions">
        {holder && (
          <button className="btn btn--primary" disabled={!perms.can_approve || enteringRecord} title={!perms.can_approve ? reasons.approve : undefined}
            onClick={needsRecord ? () => setEnteringRecord(true) : () => passHandler()}>
            {needsRecord ? 'Enter record and approve' : (PASS_LABEL[status] || 'Approve')}
          </button>
        )}
        {perms.can_reject && !rejecting && <button className="btn btn--seal" onClick={() => setRejecting(true)}>Reject</button>}
        {perms.can_withdraw && <button className="btn" onClick={on.withdraw}>Withdraw</button>}
        {perms.can_flag && !raising && <button className="btn" onClick={() => setRaising(true)}>Raise a concern</button>}
        {!holder && !perms.can_withdraw && !perms.can_flag && (
          <span className="wf-request-meta">{reasons.approve || reasons.all || `Waiting on the ${waitingOn}.`}</span>
        )}
      </div>
      {holder && !perms.can_approve && reasons.approve && <p className="wf-request-meta">{reasons.approve}</p>}
      {!holder && perms.can_flag && <p className="wf-request-meta">{reasons.approve} With the {waitingOn} now.</p>}

      {enteringRecord && needsRecord && perms.can_approve && (
        <RecordEntryForm ulpin={req.ulpin} onCancel={() => setEnteringRecord(false)}
          onSubmit={async (record) => { await on.approve(record); setEnteringRecord(false); }} />
      )}

      {rejecting && perms.can_reject && (
        <div className="stack stack--tight">
          <label className="field">Remarks for the requester
            <textarea className="input" rows={3} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
          <p className="wf-request-meta">Say what is wrong or missing, so they can fix it and file again. At least 5 characters.</p>
          <div className="btn-row">
            <button className="btn btn--seal" disabled={remarks.trim().length < 5}
              onClick={async () => { await on.reject(remarks.trim()); setRejecting(false); setRemarks(''); }}>Reject with remarks</button>
            <button className="btn" onClick={() => { setRejecting(false); setRemarks(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {raising && (
        <div className="stack stack--tight">
          <label className="field">What worries you about this request?
            <textarea className="input" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 10 characters. It goes to the reviewer who now holds the request and is recorded in the audit log." />
          </label>
          <div className="btn-row">
            <button className="btn btn--primary" disabled={reason.trim().length < 10} onClick={async () => { await on.raise(reason.trim()); setRaising(false); setReason(''); }}>Send concern</button>
            <button className="btn" onClick={() => { setRaising(false); setReason(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  );
}
