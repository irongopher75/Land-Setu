import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getAnalyticsSummary, getIntelligenceSummary } from '../api';

const pct = (n) => `${(n * 100).toFixed(1)}%`;

export default function AnalyticsDashboard({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [intel, setIntel] = useState(null);
  const [intelError, setIntelError] = useState(null);

  useEffect(() => {
    getAnalyticsSummary().then(setData).catch((e) => setError(e.message));
    getIntelligenceSummary().then(setIntel).catch((e) => setIntelError(e.message));
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

        <section className="signals" aria-labelledby="intel-title">
          <div className="signals-head"><h3 id="intel-title">Statistical signals</h3><span className="badge signal">Patterns, not rulings</span></div>
          {intelError && <p className="subtle">{intelError}</p>}
          {!intel && !intelError && <p className="subtle">Loading.</p>}
          {intel && (
            <>
              <p className="subtle">{intel.note}</p>
              <dl className="analytics-totals">
                <div><dt>Parcels checked</dt><dd className="tabular">{intel.parcels}</dd></div>
                <div><dt>With a pattern</dt><dd className="tabular">{intel.with_fraud_patterns}</dd></div>
                <div><dt>Zoning mismatches</dt><dd className="tabular">{intel.zoning_anomalies}</dd></div>
                <div><dt>Risk-scored</dt><dd className="tabular">{intel.risk.scored}</dd></div>
              </dl>
              <table className="analytics-table">
                <thead><tr><th scope="col">Pattern</th><th scope="col" className="num">Parcels</th></tr></thead>
                <tbody>
                  {Object.entries(intel.patterns).length === 0 ? <tr><td colSpan={2}>None found.</td></tr> : Object.entries(intel.patterns).map(([k, n]) => (
                    <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th><td className="num tabular">{n}</td></tr>
                  ))}
                </tbody>
              </table>
              {intel.risk.scored > 0 && (
                <table className="analytics-table">
                  <thead><tr><th scope="col">Risk band</th><th scope="col" className="num">Parcels</th></tr></thead>
                  <tbody>{['high', 'medium', 'low'].map((b) => <tr key={b}><th scope="row">{b}</th><td className="num tabular">{intel.risk.bands[b] || 0}</td></tr>)}</tbody>
                </table>
              )}
              <table className="analytics-table">
                <thead><tr><th scope="col">ULPIN</th><th scope="col">Signals</th><th scope="col">Note</th></tr></thead>
                <tbody>
                  {intel.top.map((t) => (
                    <tr key={t.ulpin}>
                      <td className="data-id">{t.ulpin}</td>
                      <td>{[...t.patterns.map((p) => p.replace(/_/g, ' ')), t.zoning_anomaly ? 'zoning mismatch' : null].filter(Boolean).join(', ')}</td>
                      <td className="subtle">{t.synthetic_fixture ? 'Planted synthetic test case' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
