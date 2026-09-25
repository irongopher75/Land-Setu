import React, { useEffect, useState } from 'react';
import { getParcelIntelligence } from '../api';

// Statistical signals are shown apart from rule flags on purpose. A rule flag is a definite breach of a stated
// rule (seal red). A signal is a pattern worth checking (navy, dotted frame, labelled as such).
const PATTERN = {
  rapid_retransfer: 'Rapid re-transfer',
  name_repetition: 'Owner name repeated across parcels',
  lien_timing: 'Change filed close to an encumbrance',
  backdating: 'Deed dates that do not fit',
};

function Evidence({ f }) {
  if (f.pattern === 'rapid_retransfer') {
    return (
      <table className="data-table"><thead><tr><th scope="col">Deed</th><th scope="col">Date</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
        <tbody>{f.evidence.map((e) => <tr key={e.transaction_id}><td className="data-id">{e.transaction_id}</td><td className="tabular">{e.deed_date}</td><td>{e.seller || 'Not recorded'}</td><td>{e.buyer || 'Not recorded'}</td></tr>)}</tbody>
      </table>
    );
  }
  if (f.pattern === 'name_repetition') {
    return (
      <table className="data-table"><thead><tr><th scope="col">ULPIN</th><th scope="col">Name on record</th><th scope="col">District</th></tr></thead>
        <tbody>{f.evidence.map((e) => <tr key={e.ulpin}><td className="data-id">{e.ulpin}</td><td>{e.owner_name}</td><td>{e.district || 'Not recorded'}</td></tr>)}</tbody>
      </table>
    );
  }
  if (f.pattern === 'lien_timing') {
    return (
      <table className="data-table"><thead><tr><th scope="col">Encumbrance raised</th><th scope="col">Request</th><th scope="col">Filed</th><th scope="col" className="num">Days apart</th></tr></thead>
        <tbody>{f.evidence.map((e, i) => <tr key={i}><td>{e.encumbrance.kind}, {e.encumbrance.holder}<div className="subtle tabular">{String(e.encumbrance.raised_at).slice(0, 10)}</div></td><td>#{e.request.id} {String(e.request.type).toLowerCase()}<div className="subtle">{String(e.request.status).replace(/_/g, ' ').toLowerCase()}</div></td><td className="tabular">{String(e.request.filed_at).slice(0, 10)}</td><td className="num tabular">{e.days_apart}</td></tr>)}</tbody>
      </table>
    );
  }
  return (
    <table className="data-table"><thead><tr><th scope="col">Deed</th><th scope="col">Executed</th><th scope="col">Recorded</th><th scope="col">Issue</th></tr></thead>
      <tbody>{f.evidence.map((e, i) => <tr key={i}><td className="data-id">{e.transaction_id}</td><td className="tabular">{e.deed_date}</td><td className="tabular">{String(e.recorded_at).slice(0, 10)}</td><td>{e.issue} ({e.days} days)</td></tr>)}</tbody>
    </table>
  );
}

export default function IntelligencePanel({ ulpin }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    getParcelIntelligence(ulpin).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [ulpin]);

  return (
    <section className="signals" aria-labelledby="signals-title">
      <div className="signals-head">
        <h3 id="signals-title">Statistical signals</h3>
        <span className="badge signal">Pattern, not a ruling</span>
      </div>
      {error && <p className="subtle">{error}</p>}
      {!data && !error && <p className="subtle">Checking patterns.</p>}
      {data && (
        <>
          <p className="subtle">{data.note}</p>
          {data.synthetic_fixture && <div className="callout">This parcel is a planted synthetic test case ({String(data.synthetic_fixture).replace(/_/g, ' ')}). It shows a detector working, not a finding about anyone.</div>}

          {data.fraud_patterns.length === 0 ? <p>No transaction or ownership patterns found.</p> : data.fraud_patterns.map((f) => (
            <div className="signal" key={f.pattern}>
              <div className="signal-title">
                <strong>{PATTERN[f.pattern] || f.pattern}</strong>
                <span className="subtle tabular">{f.severity} severity, {Math.round(f.confidence * 100)}% confidence</span>
              </div>
              <p>{f.summary}</p>
              <Evidence f={f} />
            </div>
          ))}

          <div className="signal">
            <div className="signal-title"><strong>Zoning compared with neighbours</strong>{data.zoning.anomaly && <span className="subtle">Does not match</span>}</div>
            <p>{data.zoning.explanation || 'Not computed.'}</p>
          </div>

        </>
      )}
    </section>
  );
}
