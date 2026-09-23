import React from 'react';

const sourceLine = (layer) => {
  if (!layer) return null;
  const bits = [layer.source && String(layer.source).replace(/_/g, ' '), layer.last_verified || layer.date].filter(Boolean);
  return bits.join(', ');
};

// Marks the words in `a` that do not appear in `b` (underlined, so it does not rely on colour).
const markDifferences = (a, b) => {
  const other = new Set(String(b || '').toLowerCase().split(/\s+/));
  return String(a || '').split(/\s+/).map((word, i) => (
    other.has(word.toLowerCase())
      ? <span key={i}>{word} </span>
      : <mark className="diff-mark" key={i}>{word} </mark>
  ));
};

function DiffPair({ left, right }) {
  return (
    <div className="diff-pair">
      {[left, right].map((side) => (
        <div className="diff-side" key={side.department}>
          <div className="diff-dept">{side.department}</div>
          <div className="diff-label">{side.label}</div>
          <div className="diff-value">{side.value}</div>
          {side.source && <div className="diff-source">{side.source}</div>}
        </div>
      ))}
    </div>
  );
}

function evidenceRows(evidence) {
  return Object.entries(evidence || {}).map(([k, v]) => (
    <div className="flag-evidence-row" key={k}>
      <span>{k.replace(/_/g, ' ')}</span>
      <span className="tabular">{String(v)}</span>
    </div>
  ));
}

export default function FlagDiff({ flag, layers }) {
  const ev = flag.evidence || {};
  let diff = null;

  if (flag.rule === 'ownership_mismatch') {
    diff = (
      <DiffPair
        left={{ department: 'Record of Rights', label: 'Owner on record', value: markDifferences(ev.ror_owner, ev.registration_buyer), source: sourceLine(layers?.ror) }}
        right={{ department: 'Sub-Registrar', label: 'Buyer on deed', value: markDifferences(ev.registration_buyer, ev.ror_owner), source: sourceLine(layers?.registration) }}
      />
    );
  } else if (flag.rule === 'zoning_fsi_violation' || flag.rule === 'fsi_violation') {
    const excess = Number(ev.approved_fsi) - Number(ev.permitted_fsi);
    diff = (
      <>
        <DiffPair
          left={{ department: 'Zoning', label: 'Permitted FSI', value: <span className="tabular">{ev.permitted_fsi}</span>, source: sourceLine(layers?.zoning) }}
          right={{ department: 'Building permit', label: 'Approved FSI', value: <span className="tabular"><mark className="diff-mark">{ev.approved_fsi}</mark></span>, source: sourceLine(layers?.building_permit) }}
        />
        {Number.isFinite(excess) && (
          <div className="diff-summary tabular">
            Permit exceeds zoning by {excess.toFixed(2)} ({((excess / Number(ev.permitted_fsi)) * 100).toFixed(0)}%)
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flag-box">
      <div className="flag-rule">{flag.rule.replace(/_/g, ' ')}</div>
      <div className="flag-reason">{flag.reason}</div>
      {diff || (flag.evidence && <div className="flag-evidence-list">{evidenceRows(ev)}</div>)}
    </div>
  );
}
