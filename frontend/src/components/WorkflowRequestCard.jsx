import React from 'react';

const TYPE_LABEL = { SPLIT: 'Split parcel', MERGE: 'Merge parcels', CORRECTION: 'Record correction' };

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
  return (
    <ul className="wf-summary">
      {(p.merge_ulpins || []).map((u, i) => (
        <li key={u}><span className="data-id">{u}</span> {i === 0 ? 'keeps this ULPIN' : 'is retired'}</li>
      ))}
    </ul>
  );
}

import { useAuthInfo } from '../authContext';

export default function WorkflowRequestCard({ req, role, onVillagePass, onAuditorPass, onApprove, onFastApprove, onReject }) {
  const isFast = req.status === 'PENDING_FAST_REVIEW';
  const activeIdx = STAGES.findIndex((s) => s.status === req.status);
  const actor = STAGES[activeIdx]?.actor;
  const { isSuper } = useAuthInfo();
  // Nobody acts on a request they filed. The API enforces it; the buttons follow.
  const own = !!req.filed_by_you;
  const canAct = !own && (isFast ? (role === 'auditor' || role === 'state_admin' || isSuper) : (role === actor || isSuper));
  const canReject = !own && (canAct || role === 'state_admin');

  const passHandler = isFast ? onFastApprove : { village_officer: onVillagePass, auditor: onAuditorPass, state_admin: onApprove }[actor];
  const passLabel = isFast ? 'Approve and apply the correction' : {
    village_officer: 'Verify and forward to auditor',
    auditor: 'Pass audit and forward to state admin',
    state_admin: `Approve and apply ${TYPE_LABEL[req.type].toLowerCase()}`,
  }[actor];

  return (
    <article className="wf-request">
      <header>
        <div>
          <span className="wf-request-type">{TYPE_LABEL[req.type]}</span>
          <span className="data-id">{req.ulpin}</span>
        </div>
        <span className="wf-request-id tabular">Request #{req.id}</span>
      </header>

      {isFast ? (
        <ol className="wf-stages wf-stages--two" aria-label="Approval stages">
          <li className="is-done">Filed<small>done</small></li>
          <li className="is-active">Auditor or state admin<small>one approval finishes it</small></li>
        </ol>
      ) : (
      <ol className="wf-stages" aria-label="Approval stages">
        {STAGES.map((s, i) => {
          const skipped = req.type !== 'CORRECTION' && i === 0;
          const state = i < activeIdx || (skipped && activeIdx > 0) ? 'done' : i === activeIdx ? 'active' : 'waiting';
          return (
            <li key={s.status} className={`is-${skipped ? 'skipped' : state}`}>
              {s.label}
              <small>{skipped ? 'not needed' : state === 'done' ? 'passed' : state === 'active' ? 'current' : 'waiting'}</small>
            </li>
          );
        })}
      </ol>
      )}

      <Summary req={req} />
      <p className="wf-request-meta">Filed by {req.requested_by} ({req.requester_role}). {req.reason}</p>

      <div className="wf-actions">
        {canAct && passHandler && <button className="btn btn--primary" onClick={passHandler}>{passLabel}</button>}
        {canReject && <button className="btn btn--seal" onClick={onReject}>{role === 'state_admin' ? 'Withdraw' : 'Reject'}</button>}
        {own && <span className="wf-request-meta">You filed this request. Another person must act on it.</span>}
        {!own && !canAct && !canReject && <span className="wf-request-meta">Waiting on the {isFast ? 'auditor or state admin' : STAGES[activeIdx]?.label.toLowerCase()}.</span>}
      </div>
    </article>
  );
}
