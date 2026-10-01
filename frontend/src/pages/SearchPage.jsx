import React, { useEffect, useState } from 'react';
import PageShell from '../components/PageShell';
import { searchParcelsPage } from '../api';
import { navigate } from '../router';

const MATCH = { ulpin: 'ULPIN', owner: 'Owner name', khata: 'Khata number' };

export default function SearchPage({ initialQuery = '', onPick }) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setTotal(0); return undefined; }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      searchParcelsPage(term, 0)
        .then((r) => { if (live) { setResults(r.items); setTotal(r.total || r.items.length); } })
        .catch(() => live && setResults([]))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);

  const loadMore = () => {
    setBusy(true);
    searchParcelsPage(q.trim(), results.length)
      .then((r) => setResults((prev) => [...prev, ...r.items]))
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const onChange = (value) => {
    setQ(value);
    navigate(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : '/search');
  };

  return (
    <PageShell title="Search parcels">
      <label className="field">
        ULPIN, owner name or khata number
        <input className="input" type="search" value={q} onChange={(e) => onChange(e.target.value)} placeholder="For example TN-CHN-0042-1187, Kannan or KH-1187" autoFocus />
      </label>
      <div aria-live="polite">
        {busy && <p className="subtle">Searching.</p>}
        {results && results.length === 0 && !busy && <p>No parcel matches "{q.trim()}".</p>}
        {results && results.length > 0 && (
          <table className="data-table">
            <thead><tr><th scope="col">ULPIN</th><th scope="col">Owner of record</th><th scope="col">Khata</th><th scope="col">State</th><th scope="col">Matched on</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.ulpin}>
                  <td><span className="data-id">{r.ulpin}</span></td>
                  <td>{r.owner_name || 'Not recorded'}</td>
                  <td>{r.khata_no ? <span className="data-id">{r.khata_no}</span> : 'Not recorded'}</td>
                  <td>{r.state}</td>
                  <td>{MATCH[r.matched_on] || ''}</td>
                  <td><button className="btn" onClick={() => onPick(r)}>Open on map</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {results && results.length > 0 && (
          <p className="subtle">Showing {results.length} of {total}.{' '}
            {results.length < total && <button className="btn" onClick={loadMore} disabled={busy}>Load more</button>}
          </p>
        )}
        {results === null && <p className="subtle">Type at least two characters.</p>}
      </div>
    </PageShell>
  );
}
