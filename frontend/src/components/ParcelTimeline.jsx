import React, { useEffect, useState } from 'react';
import ConfidenceBadge from './ConfidenceBadge';
import { getParcelHistory } from '../api';

const KIND_LABEL = {
  ror: 'Record of Rights',
  registration: 'Registration',
  permit: 'Building permit',
  tax: 'Tax',
  request: 'Request',
};

const formatDate = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return String(d);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function ParcelTimeline({ ulpin }) {
  const [state, setState] = useState({ loading: true, events: [], source: 'live', error: null });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    getParcelHistory(ulpin)
      .then((res) => live && setState({ loading: false, events: res.events, source: res.source, error: null }))
      .catch((err) => live && setState({ loading: false, events: [], source: 'live', error: err.message }));
    return () => { live = false; };
  }, [ulpin]);

  if (state.loading) return <div className="note">Loading history for {ulpin}</div>;
  if (state.error) return <div className="note note note--alert">{state.error}</div>;
  if (state.events.length === 0) return <div className="note">No recorded events for this parcel.</div>;

  const dated = state.events.filter((e) => e.date);
  const undated = state.events.filter((e) => !e.date);

  const renderEvent = (e, i) => (
    <li className="timeline-item" key={`${e.kind}-${i}`}>
      <div className="timeline-date tabular">{formatDate(e.date) || 'Date not recorded'}</div>
      <div className="timeline-body">
        <div className="timeline-kind">{KIND_LABEL[e.kind] || e.kind}</div>
        <div className="timeline-title">{e.title}</div>
        {e.detail && <div className="timeline-detail">{e.detail}</div>}
        <div className="timeline-meta">
          {e.source && <span>Source: {String(e.source).replace(/_/g, ' ')}</span>}
          {e.confidence && <ConfidenceBadge confidence={e.confidence} />}
        </div>
      </div>
    </li>
  );

  return (
    <div className="timeline">
      {state.source === 'offline' && (
        <div className="note">Offline mode: showing department records only. Request history needs the live API.</div>
      )}
      <ol className="timeline-list">{dated.map(renderEvent)}</ol>
      {undated.length > 0 && (
        <>
          <div className="timeline-undated-title">No date on record</div>
          <ol className="timeline-list">{undated.map(renderEvent)}</ol>
        </>
      )}
    </div>
  );
}
