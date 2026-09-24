import React, { useState } from 'react';
import PageShell from '../components/PageShell';
import { getParcelDetail } from '../api';

export default function BankPage() {
  const [ulpin, setUlpin] = useState('');
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await getParcelDetail(ulpin.trim());
      const enc = p?.layers?.encumbrance;
      setOut({
        ulpin: p.ulpin, state: p.state,
        encumbered: !!enc?.active, kind: enc?.type || null,
        flags: Array.isArray(p.flags) ? p.flags.length : 0,
        verified: enc?.last_verified || p?.layers?.registration?.date || null,
      });
    } catch (err) {
      setOut({ error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="Lender verification">
      <div className="callout"><strong>Preview.</strong> Bank and lender accounts are planned for the pilot phase. This shows what a lender would see: clearance and encumbrance only. No owner details.</div>
      <form onSubmit={check} className="stack">
        <label className="field">ULPIN of the parcel offered as collateral
          <input className="input data-id" value={ulpin} onChange={(e) => setUlpin(e.target.value)} placeholder="TN-CHN-0042-1187" required />
        </label>
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Checking' : 'Check clearance'}</button>
      </form>
      {out && out.error && <div className="callout callout--alert" role="alert">No record found for that ULPIN.</div>}
      {out && !out.error && (
        <div role="status">
          <div className={`callout ${out.encumbered ? 'callout--alert' : 'callout--verified'}`}>
            {out.encumbered ? `Active encumbrance on record${out.kind ? `: ${out.kind}` : ''}.` : 'No active encumbrance on record.'}
          </div>
          <div className="stat-line"><span>ULPIN</span><strong className="data-id">{out.ulpin}</strong></div>
          <div className="stat-line"><span>State</span><strong>{out.state}</strong></div>
          <div className="stat-line"><span>Open record flags</span><strong className="tabular">{out.flags}</strong></div>
          <div className="stat-line"><span>Last verified</span><strong className="tabular">{out.verified || 'Not recorded'}</strong></div>
          <p className="subtle">Synthetic data. This is not a legal clearance certificate.</p>
        </div>
      )}
    </PageShell>
  );
}
