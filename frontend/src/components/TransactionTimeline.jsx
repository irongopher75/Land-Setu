import React, { useEffect, useState } from 'react';
import { getParcelTransactions, openTransaction, actOnTransactionStage, handoffTransaction } from '../api';

// Two levels. The outer track is the departments the transaction passes through. Under each department that has
// started, its officer stages. A handoff between departments is drawn as its own row, so the trail reads
// Registration, Revenue, Municipal, not only who clicked what.

const DEPT_STATE = {
  complete: 'Complete',
  active: 'In progress',
  paused: 'On hold',
  rejected: 'Rejected',
  upcoming: 'Not started',
};

const TX_STATUS = {
  pending: 'Waiting for handoff',
  in_review: 'In review',
  objected: 'Objected',
  approved: 'Approved',
  rejected: 'Rejected',
};

const ACTION_LABEL = {
  approved: 'Approved',
  auto_verified: 'Auto-verified',
  auto_rekeyed: 'Re-keyed automatically',
  objected: 'Objected',
  rejected: 'Rejected',
};

const ROLE_LABEL = {
  officer: 'Sub-Registrar',
  village_officer: 'Village officer',
  auditor: 'Supervisor',
  state_admin: 'State officer',
};

// Who may start a transaction: mirrors POST /transactions (require_roles). The API refuses anyone else and
// its message is shown as is. Handoffs and stage decisions are offered only to the role the API expects.
const OPENERS = ['officer', 'state_admin', 'super_admin'];
const OPEN_STATUSES = ['pending', 'in_review', 'objected'];

const currentDept = (tx) => tx.departments.find((d) => d.department === tx.current_department);
const waitingStage = (tx) => currentDept(tx)?.stages.find((s) => !s.action) || null;
const nextHandoffDept = (tx) => {
  const i = tx.departments.findIndex((d) => d.department === tx.current_department);
  const nxt = tx.departments.slice(i + 1).find((d) => d.state === 'upcoming');
  return nxt && !nxt.auto ? nxt : null;
};

const formatDate = (d) => {
  if (!d) return '';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return String(d);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const labelOf = (dept, departments) => departments.find((d) => d.department === dept)?.label
  || String(dept || '').replace(/_/g, ' ').toLowerCase();

function TxActions({ tx, role, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [remarks, setRemarks] = useState('');
  if (!OPEN_STATUSES.includes(tx.status) || tx.status === 'objected') return null;

  const stage = waitingStage(tx);
  const handoffTo = !stage ? nextHandoffDept(tx) : null;
  const deptRoles = (currentDept(tx)?.stages || []).map((s) => s.role_required);
  const canHandoff = handoffTo && (role === 'super_admin' || deptRoles.includes(role));
  const canDecide = stage && (role === 'super_admin' || role === stage.role_required);

  const run = async (fn) => {
    setBusy(true); setMsg(null);
    try { await fn(); setRejecting(false); setRemarks(''); await onDone(); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  };

  if (!canHandoff && !canDecide) {
    return stage ? <div className="tx-note">Waiting for {ROLE_LABEL[stage.role_required] || stage.role_required}. Sign in as that role to continue.</div> : null;
  }
  return (
    <div className="tx-actions" role="group" aria-label="Transaction actions">
      {canHandoff && (
        <button className="btn" disabled={busy}
          onClick={() => run(() => handoffTransaction(tx.id, handoffTo.department, `Hand off to ${handoffTo.label}`))}>
          Hand off to {handoffTo.label}
        </button>
      )}
      {canDecide && !rejecting && (
        <>
          <button className="btn btn--seal" disabled={busy}
            onClick={() => run(() => actOnTransactionStage(tx.id, 'approve', `${stage.stage_name} approved`))}>
            Advance: approve {stage.stage_name}
          </button>
          <button className="btn" disabled={busy} onClick={() => setRejecting(true)}>Reject with remarks</button>
        </>
      )}
      {canDecide && rejecting && (
        <div>
          <label className="field">Reasons for rejecting (at least 10 characters)
            <textarea className="input" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
          <button className="btn" disabled={busy || remarks.trim().length < 10}
            onClick={() => run(() => actOnTransactionStage(tx.id, 'reject', remarks.trim()))}>Reject transaction</button>
          <button className="btn" disabled={busy} onClick={() => { setRejecting(false); setRemarks(''); }}>Cancel</button>
        </div>
      )}
      {msg && <div className="note note--alert" role="alert">{msg}</div>}
    </div>
  );
}

function Transaction({ tx, role, onDone }) {
  const handoffTo = (dept) => tx.handoffs.filter((h) => h.to_department === dept);

  return (
    <article className="tx-card" aria-label={`Transaction ${tx.id}`}>
      <header className="tx-head">
        <div>
          <div className="tx-title">{tx.transaction_type} · deed <span className="tabular">{tx.deed_reference}</span></div>
          <div className="tx-sub">Opened {formatDate(tx.initiated_at)}{tx.buyer_name ? ` · new owner ${tx.buyer_name}` : ''}</div>
        </div>
        <span className={`tx-status tx-status--${tx.status}`}>{TX_STATUS[tx.status] || tx.status}</span>
      </header>
      {tx.current_stage && tx.status !== 'approved' && (
        <div className="tx-now"><strong>Now:</strong> {tx.current_stage}</div>
      )}
      <TxActions tx={tx} role={role} onDone={onDone} />
      {tx.auto_mutation && (
        <div className="tx-note">
          {tx.auto_mutation.eligible
            ? 'Auto-mutation: routine sale with clean records. Revenue field stages were verified automatically. Registration, the Revenue approval and Municipal still ran.'
            : `Full review: ${tx.auto_mutation.reasons.join('; ')}.`}
        </div>
      )}

      <ol className="tx-depts">
        {tx.departments.map((d, i) => (
          <li key={d.department} className={`tx-dept tx-dept--${d.state}`} aria-current={d.state === 'active' ? 'step' : undefined}>
            {handoffTo(d.department).map((h, k) => (
              <div className="tx-handoff" key={k}>
                <span aria-hidden="true">↳</span> Handoff{h.from_department ? ` from ${labelOf(h.from_department, tx.departments)}` : ''} · {formatDate(h.handoff_at)}
                <div className="tx-handoff-reason">{h.handoff_reason}</div>
              </div>
            ))}
            <div className="tx-dept-head">
              <span className="tx-dept-num" aria-hidden="true">{i + 1}</span>
              <span className="tx-dept-name">{d.label}</span>
              {d.auto && <span className="tx-tag">Starts on its own</span>}
              <span className="tx-dept-state">{DEPT_STATE[d.state] || d.state}</span>
            </div>
            {(d.stages.length > 0 || d.upcoming_stages.length > 0) && (
              <ol className="tx-stages">
                {d.stages.map((s) => (
                  <li key={s.stage_order} className={`tx-stage tx-stage--${s.action || 'waiting'}`}>
                    <div className="tx-stage-name">{s.stage_name}</div>
                    <div className="tx-stage-meta">
                      {s.action ? ACTION_LABEL[s.action] || s.action : `Waiting for ${ROLE_LABEL[s.role_required] || s.role_required}`}
                      {s.acted_at ? ` · ${formatDate(s.acted_at)}` : ''}
                    </div>
                    {s.remarks && <div className="tx-stage-remarks">{s.remarks}</div>}
                  </li>
                ))}
                {d.upcoming_stages.map((s) => (
                  <li key={s.stage_name} className="tx-stage tx-stage--upcoming">
                    <div className="tx-stage-name">{s.stage_name}</div>
                    <div className="tx-stage-meta">{s.auto_verify ? 'Will be auto-verified' : `Then: ${ROLE_LABEL[s.role_required] || s.role_required}`}</div>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>

      {tx.dispute_cases.map((c) => (
        <div className="tx-dispute" key={c.id} role="group" aria-label="Dispute case">
          <strong>Dispute case</strong>
          <div>Objection: {c.objection_reason}</div>
          <div className="tx-stage-meta">
            Raised {formatDate(c.objected_at)}
            {c.escalated_at ? ` · escalated ${formatDate(c.escalated_at)}` : ' · not yet escalated'}
            {c.resolution ? ` · ${c.resolution === 'dismissed' ? 'objection dismissed' : 'objection upheld'} ${formatDate(c.resolved_at)}` : ''}
          </div>
        </div>
      ))}

      {tx.municipal_push && (
        <div className="tx-note">
          Property tax re-keyed after Revenue approved: {tx.municipal_push.assessee_before || 'no assessee on file'} to {tx.municipal_push.assessee_after}.
        </div>
      )}

      <details className="tx-notices">
        <summary>Notifications sent ({tx.notifications.length})</summary>
        <ul>
          {tx.notifications.map((n, i) => (
            <li key={i}><span className="tabular">{formatDate(n.created_at)}</span> {n.message}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export default function TransactionTimeline({ ulpin, role, deedReference }) {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [startMsg, setStartMsg] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = () => getParcelTransactions(ulpin)
    .then((items) => setState({ loading: false, items, error: null }))
    .catch((err) => setState({ loading: false, items: [], error: err.message }));

  useEffect(() => {
    let live = true;
    setState({ loading: true, items: [], error: null });
    setStartMsg(null);
    getParcelTransactions(ulpin)
      .then((items) => live && setState({ loading: false, items, error: null }))
      .catch((err) => live && setState({ loading: false, items: [], error: err.message }));
    return () => { live = false; };
  }, [ulpin]);

  const start = async () => {
    setStarting(true); setStartMsg(null);
    try {
      await openTransaction({ ulpin, transaction_type: 'sale', deed_reference: deedReference });
      await load();
    } catch (err) { setStartMsg(err.message); } finally { setStarting(false); }
  };

  if (state.loading) return <div className="note">Loading transactions for {ulpin}</div>;
  if (state.error) return <div className="note note--alert">{state.error}</div>;

  const deedUsed = state.items.some((t) => t.deed_reference === deedReference && t.status !== 'rejected');
  const canStart = OPENERS.includes(role) && deedReference && !deedUsed && !state.items.some((t) => OPEN_STATUSES.includes(t.status));

  return (
    <section className="tx-list" aria-label="Ownership transactions">
      {state.items.length === 0 && <div className="note">No ownership transactions on this parcel.</div>}
      {canStart && (
        <div className="tx-actions">
          <button className="btn btn--seal" onClick={start} disabled={starting}>
            Start transaction for deed {deedReference}
          </button>
          {startMsg && <div className="note note--alert" role="alert">{startMsg}</div>}
        </div>
      )}
      {state.items.map((tx) => <Transaction key={tx.id} tx={tx} role={role} onDone={load} />)}
    </section>
  );
}
