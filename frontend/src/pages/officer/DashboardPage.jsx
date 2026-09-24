import React, { useEffect, useState } from 'react';
import OfficerFrame from './OfficerFrame';
import { getPendingRequests } from '../../api';

const TYPE_LABEL = { SPLIT: 'Split', MERGE: 'Merge', CORRECTION: 'Correction', DELETION: 'Deletion' };
const STAGE_LABEL = {
  PENDING_VILLAGE_REVIEW: 'Village officer review',
  PENDING_DELETION_VILLAGE: 'Village officer review',
  PENDING_AUDITOR_REVIEW: 'Auditor review',
  PENDING: 'Auditor review',
  PENDING_APPROVAL: 'Auditor review',
  PENDING_DELETION_AUDITOR: 'Auditor review',
  PENDING_STATE_ADMIN: 'State administrator approval',
};

// What each role acts on next.
const MINE = {
  village_officer: ['Village officer review'],
  auditor: ['Auditor review'],
  state_admin: ['State administrator approval'],
};

const typeOf = (r) => TYPE_LABEL[r.type] || (String(r.status).includes('DELETION') ? 'Deletion' : 'Boundary change');
const count = (list, fn) => list.reduce((acc, r) => { const k = fn(r); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

export default function DashboardPage({ role, isLoggedIn }) {
  const [reqs, setReqs] = useState(null);
  useEffect(() => {
    if (!isLoggedIn) return;
    getPendingRequests().then((r) => setReqs(Array.isArray(r) ? r : [])).catch(() => setReqs([]));
  }, [isLoggedIn]);

  const list = reqs || [];
  const byStage = count(list, (r) => STAGE_LABEL[r.status] || 'Other');
  const byType = count(list, typeOf);
  const mine = list.filter((r) => (MINE[role] || []).includes(STAGE_LABEL[r.status]));
  const recent = [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 6);

  return (
    <OfficerFrame title="Officer dashboard" path="/officer" role={role} isLoggedIn={isLoggedIn}>
      <dl className="stat-strip">
        <div><dt>Open requests</dt><dd>{reqs ? list.length : '-'}</dd></div>
        <div><dt>Waiting on you</dt><dd className={mine.length ? 'is-alert' : ''}>{reqs ? mine.length : '-'}</dd></div>
        <div><dt>At village review</dt><dd>{byStage['Village officer review'] || 0}</dd></div>
        <div><dt>At audit</dt><dd>{byStage['Auditor review'] || 0}</dd></div>
        <div><dt>At state approval</dt><dd>{byStage['State administrator approval'] || 0}</dd></div>
      </dl>

      <section>
        <h2>Open requests by type</h2>
        {list.length === 0 ? <p className="subtle">{reqs === null ? 'Loading.' : 'No open requests.'}</p> : (
          <table className="data-table">
            <thead><tr><th scope="col">Type</th><th scope="col" className="num">Open</th></tr></thead>
            <tbody>{Object.entries(byType).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td className="num tabular">{v}</td></tr>)}</tbody>
          </table>
        )}
        <p><a className="btn btn--primary" href="#/officer/queue">Open the approval queue</a></p>
      </section>

      <section>
        <h2>Recent requests</h2>
        {recent.length === 0 ? <p className="subtle">Nothing to show.</p> : (
          <table className="data-table">
            <thead><tr><th scope="col">Request</th><th scope="col">Type</th><th scope="col">ULPIN</th><th scope="col">Stage</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="tabular">#{r.id}</td>
                  <td>{typeOf(r)}</td>
                  <td><span className="data-id">{r.ulpin}</span></td>
                  <td>{STAGE_LABEL[r.status] || r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Tools</h2>
        <ol className="checks-list">
          <li><span className="checks-name"><a href="#/officer/editor">Parcel editor</a></span><span>Draw a boundary, reshape, split or merge parcels.</span></li>
          <li><span className="checks-name"><a href="#/officer/audit">Audit log</a></span><span>Every approval and change, with its hash.</span></li>
          {role === 'state_admin' && <li><span className="checks-name"><a href="#/officer/import">Data import</a></span><span>Preview how a state's raw records map to the common schema.</span></li>}
          {role === 'state_admin' && <li><span className="checks-name"><a href="#/officer/analytics">Analytics</a></span><span>Parcels, flags, requests and encumbrances by state.</span></li>}
        </ol>
      </section>
    </OfficerFrame>
  );
}
