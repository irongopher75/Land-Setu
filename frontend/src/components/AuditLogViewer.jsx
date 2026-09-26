import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { getAuditLog } from '../api';

// The records service's audit log across all parcels (GET /parcels/audit-log), newest first.
// Each row is an entry in a parcel's hash chain; a parcel's own chain is re-verified on its record.
const EVENT_LABEL = {
  imported: 'Record loaded', created: 'Created', submitted: 'Request filed', under_review: 'Passed a review stage',
  approved: 'Approved', rejected: 'Rejected', archived: 'Archived', superseded: 'Replaced', concern_raised: 'Concern raised',
  geometry_corrected: 'Seed boundary corrected',
};
const ROLE_LABEL = {
  system: 'System', citizen: 'Citizen', village_officer: 'Village officer', auditor: 'Auditor', state_admin: 'State admin',
  super_admin: 'Super admin', officer: 'Officer', bank: 'Bank',
};
const PAGE = 50;
const short = (h) => (h ? `${h.slice(0, 10)}...${h.slice(-6)}` : '');

export default function AuditLogViewer() {
  const [filters, setFilters] = useState({ ulpin: '', event: '', actor_role: '', date_from: '', date_to: '' });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await getAuditLog({ ...applied, offset, limit: PAGE }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applied, offset]);

  useEffect(() => { load(); }, [load]);

  const apply = (e) => { e.preventDefault(); setOffset(0); setApplied(filters); };
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  const exportCsv = () => {
    const header = ['created_at', 'ulpin', 'seq', 'event', 'actor_role', 'request_id', 'from_status', 'to_status', 'note', 'entry_hash'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header.join(','), ...(page?.items || []).map((r) => header.map((k) => esc(r[k])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `landsetu-audit-log-${offset + 1}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = page?.total ?? 0;
  return (
    <section className="stack">
      <form className="row row--wrap" onSubmit={apply} aria-label="Filter the audit log">
        <label className="field">ULPIN<input className="input data-id" value={filters.ulpin} onChange={set('ulpin')} /></label>
        <label className="field">Event
          <select className="input" value={filters.event} onChange={set('event')}>
            <option value="">All events</option>
            {Object.entries(EVENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">Actor
          <select className="input" value={filters.actor_role} onChange={set('actor_role')}>
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">From<input className="input" type="date" value={filters.date_from} onChange={set('date_from')} /></label>
        <label className="field">To<input className="input" type="date" value={filters.date_to} onChange={set('date_to')} /></label>
        <div className="btn-row">
          <button className="btn btn--primary" type="submit">Apply</button>
          <button className="btn" type="button" onClick={load} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
          <button className="btn" type="button" onClick={exportCsv} disabled={!page?.items?.length}><Download size={14} aria-hidden="true" /> Export this page</button>
        </div>
      </form>

      {error && <div className="callout callout--alert" role="alert">The audit log could not be loaded. {error}</div>}
      {loading && !page && <p className="note" role="status">Loading the audit log</p>}
      {page && page.items.length === 0 && <p className="note" role="status">No entries match these filters.</p>}

      {page && page.items.length > 0 && (
        <>
          <p className="subtle" role="status">{loading ? 'Updating. ' : ''}Entries {offset + 1} to {offset + page.items.length} of {total}.</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>When</th><th>ULPIN</th><th>Event</th><th>Actor</th><th>Request</th><th>Status</th><th>Note</th><th>Entry hash</th></tr>
              </thead>
              <tbody>
                {page.items.map((r) => (
                  <tr key={r.entry_hash}>
                    <td className="tabular">{new Date(r.created_at).toLocaleString('en-IN')}</td>
                    <td className="data-id">{r.ulpin}</td>
                    <td>{EVENT_LABEL[r.event] || r.event}</td>
                    <td>{ROLE_LABEL[r.actor_role] || r.actor_role}</td>
                    <td className="tabular">{r.request_id ? `#${r.request_id}` : ''}</td>
                    <td>{r.to_status ? r.to_status.replace(/_/g, ' ').toLowerCase() : ''}</td>
                    <td>{r.note || ''}</td>
                    <td className="data-id" title={r.entry_hash}>{short(r.entry_hash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row">
            <button className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</button>
            <button className="btn" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>Older</button>
          </div>
        </>
      )}
    </section>
  );
}
