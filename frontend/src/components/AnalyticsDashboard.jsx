import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getAnalyticsSummary } from '../api';

const pct = (n) => `${(n * 100).toFixed(1)}%`;

export default function AnalyticsDashboard({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getAnalyticsSummary().then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="State analytics">
      <div className="modal-card analytics-card">
        <div className="modal-head">
          <div>
            <h3>State analytics</h3>
            <p>Counted from parcel records, cached rule flags and open requests.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {error && <div className="note note note--alert">{error}</div>}
        {!data && !error && <div className="note">Loading counts</div>}

        {data && (
          <>
            <dl className="analytics-totals">
              <div><dt>Parcels</dt><dd className="tabular">{data.totals.total_parcels}</dd></div>
              <div><dt>Flagged</dt><dd className="tabular">{data.totals.flagged_parcels} <small>({pct(data.totals.flagged_rate)})</small></dd></div>
              <div><dt>Open requests</dt><dd className="tabular">{data.totals.pending_requests}</dd></div>
              <div><dt>Encumbered</dt><dd className="tabular">{data.totals.encumbered_parcels} <small>({pct(data.totals.encumbrance_rate)})</small></dd></div>
            </dl>

            <table className="analytics-table">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col" className="num">Parcels</th>
                  <th scope="col" className="num">Flagged</th>
                  <th scope="col" className="num">Open requests</th>
                  <th scope="col" className="num">Encumbrance rate</th>
                  <th scope="col">Flags by rule</th>
                </tr>
              </thead>
              <tbody>
                {data.states.map((s) => (
                  <tr key={s.state}>
                    <th scope="row">{s.state}</th>
                    <td className="num tabular">{s.total_parcels}</td>
                    <td className="num tabular">{s.flagged_parcels} ({pct(s.flagged_rate)})</td>
                    <td className="num tabular">{s.pending_requests}</td>
                    <td className="num tabular">{pct(s.encumbrance_rate)}</td>
                    <td>
                      {Object.keys(s.flags_by_rule).length === 0 ? 'None' : Object.entries(s.flags_by_rule).map(([rule, n]) => (
                        <span className="rule-count" key={rule}>{rule.replace(/_/g, ' ')} <b className="tabular">{n}</b></span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
