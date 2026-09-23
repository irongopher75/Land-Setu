import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchParcels } from '../api';

const MATCH_LABEL = { ulpin: 'ULPIN', owner: 'Owner', khata: 'Khata no.' };

export default function ParcelSearch({ selectedState, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      searchParcels(q, null)
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (r) => {
    setOpen(false);
    setQ('');
    onPick(r);
  };

  return (
    <div className="parcel-search" ref={wrapRef}>
      <label className="parcel-search-field">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={q}
          placeholder="ULPIN, owner or khata number"
          aria-label="Search parcels by ULPIN, owner name or khata number"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </label>
      {open && q.trim().length >= 2 && (
        <ul className="parcel-search-results" role="listbox">
          {busy && results.length === 0 && <li className="parcel-search-empty">Searching</li>}
          {!busy && results.length === 0 && <li className="parcel-search-empty">No parcel matches "{q.trim()}"</li>}
          {results.map((r) => (
            <li key={r.ulpin}>
              <button type="button" role="option" onClick={() => pick(r)}>
                <span className="data-id">{r.ulpin}</span>
                <span className="parcel-search-meta">
                  {r.owner_name || 'Owner not recorded'}
                  {r.khata_no ? <> · <span className="data-id">{r.khata_no}</span></> : null}
                  {' · '}{r.state}
                </span>
                <span className="parcel-search-match">Matched {MATCH_LABEL[r.matched_on] || r.matched_on}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
