import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { getAuditChain } from '../api';
import { getDeedBlockchain } from '../blockchain';

const EVENT_LABEL = {
  imported: 'Record loaded', created: 'Created', submitted: 'Change requested', under_review: 'Passed a review stage',
  approved: 'Approved', rejected: 'Rejected', archived: 'Archived', superseded: 'Replaced by another parcel',
};
const ROLE_LABEL = {
  system: 'System', citizen: 'Citizen', village_officer: 'Village land officer', auditor: 'Auditor',
  state_admin: 'State administrator', super_admin: 'Super administrator', officer: 'Officer', bank: 'Bank',
};
const short = (h) => (h ? `${h.slice(0, 12)}...${h.slice(-8)}` : '');

export default function BlockchainExplorerModal({ ulpin, parcel, onClose }) {
  const [chain, setChain] = useState(null);      // audit log from the records service
  const [legacy, setLegacy] = useState(null);    // browser-side record, only when the service is unreachable
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const live = await getAuditChain(ulpin);
    setChain(live);
    if (!live) {
      try { setLegacy(await getDeedBlockchain(ulpin, parcel)); } catch (e) { setLegacy([]); }
    }
    setLoading(false);
  }, [ulpin, parcel]);

  useEffect(() => { if (ulpin) load(); }, [ulpin, load]);

  if (!ulpin) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--wide" role="dialog" aria-modal="true" aria-label="Audit log" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Audit log</h3>
            <p>ULPIN <span className="data-id">{ulpin}</span>. Every change is stored in a secure, tamper-evident audit log. Each entry holds the SHA-256 of the entry before it.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {chain && (
          <div className={`chain-status ${chain.verified ? '' : 'chain-status--broken'}`} role="status">
            <div>
              <strong>{chain.verified ? 'Log verified' : `Log altered at entry ${chain.broken_at}`}</strong>
              <span className="tabular">
                {chain.entries.length} {chain.entries.length === 1 ? 'entry' : 'entries'}, hashes recomputed by the server just now.
              </span>
            </div>
            <button className="btn" onClick={load} disabled={loading}><RefreshCw size={13} aria-hidden="true" /> Verify again</button>
          </div>
        )}

        {!chain && !loading && (
          <div className="callout callout--alert" role="status">
            The records service is not reachable, so the live audit log cannot be shown. Below is the older record kept in this browser. It is not the audit log and is not verified.
          </div>
        )}

        {loading ? (
          <div className="note">Loading the audit log</div>
        ) : chain ? (
          <ol className="chain-list">
            {chain.entries.map((e) => (
              <li className="chain-block" key={e.seq}>
                <div className="chain-block-head">
                  <span className="chain-block-n tabular">Entry {e.seq}</span>
                  <span>{EVENT_LABEL[e.event] || e.event}</span>
                  <span className="chain-block-time tabular">{new Date(e.created_at).toLocaleString('en-IN')}</span>
                </div>
                <div className="subtle">
                  {ROLE_LABEL[e.actor_role] || e.actor_role}
                  {e.to_status ? `. Status: ${e.from_status ? `${e.from_status.replace(/_/g, ' ').toLowerCase()} to ` : ''}${e.to_status.replace(/_/g, ' ').toLowerCase()}` : ''}
                  {e.request_id ? `. Request #${e.request_id}` : ''}
                </div>
                {e.note && <div>{e.note}</div>}
                <dl className="chain-hashes">
                  <div><dt>Hash</dt><dd title={e.entry_hash}>{short(e.entry_hash)}</dd></div>
                  <div><dt>Previous</dt><dd title={e.prev_hash}>{short(e.prev_hash)}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="chain-list">
            {(legacy || []).map((blk) => (
              <li className="chain-block" key={blk.blockHeight}>
                <div className="chain-block-head">
                  <span className="chain-block-n tabular">Legacy {blk.blockHeight}</span>
                  <span>{blk.actionType.replace(/_/g, ' ').toLowerCase()}</span>
                </div>
                <dl className="chain-hashes"><div><dt>Hash</dt><dd>{short(blk.currentHash)}</dd></div></dl>
              </li>
            ))}
          </ol>
        )}

        <button className="btn btn--primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
