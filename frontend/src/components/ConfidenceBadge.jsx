import React from 'react';
import { BadgeCheck, Clock, FlaskConical, HelpCircle, MessageSquareQuote, PencilLine, UserCheck } from 'lucide-react';

// Provenance of a value: who stands behind it. One shape for every state; colour, border style, glyph and
// words each say which state it is, so none depends on colour alone. Colours are reserved in
// styles/tokens.css (--ls-verified, --ls-officer, --ls-corrected, --ls-unconfirmed).
//
// Only 'verified' reads as confirmed, and only the records service assigns it, from a department's own record.
// A missing or unknown value is shown as not confirmed, never as verified.

const DEFAULT_DEPARTMENT = 'the department';

export const PROVENANCE = {
  verified: {
    tone: 'verified',
    Icon: BadgeCheck,
    label: 'Verified',
    detail: (dept) => `From ${dept || DEFAULT_DEPARTMENT}'s own record, and current.`,
  },
  stale: {
    tone: 'unconfirmed',
    Icon: Clock,
    label: 'Out of date',
    detail: (dept) => `From ${dept || DEFAULT_DEPARTMENT}'s record, but not confirmed in the last three years.`,
  },
  officer_provided: {
    tone: 'officer',
    Icon: UserCheck,
    label: 'Provided by reviewing officer',
    detail: (dept) => `Entered when the parcel was approved. Not independently confirmed by ${dept || DEFAULT_DEPARTMENT}.`,
  },
  corrected_by_officer: {
    tone: 'corrected',
    Icon: PencilLine,
    label: 'Corrected by officer',
    detail: (dept) => `Changed by an approved correction. Not independently confirmed by ${dept || DEFAULT_DEPARTMENT}.`,
  },
  self_declared: {
    tone: 'unconfirmed',
    Icon: MessageSquareQuote,
    label: 'Self-declared',
    detail: () => 'Stated by the applicant. Not confirmed by any department.',
  },
  unverified_placeholder: {
    tone: 'unconfirmed',
    Icon: FlaskConical,
    label: 'Sample value',
    detail: () => 'Bundled sample shown because the records service cannot be reached. Not a record.',
  },
  unverified: {
    tone: 'unconfirmed',
    Icon: HelpCircle,
    label: 'Not confirmed',
    detail: () => 'No department record supplies this value.',
  },
};

const keyOf = (confidence) => {
  const k = String(confidence || '').toLowerCase();
  return PROVENANCE[k] ? k : 'unverified';
};

export const provenanceOf = (confidence) => PROVENANCE[keyOf(confidence)];

// size="compact": label only, qualifier in the tooltip and for screen readers (tables, map popups).
// size="full": label plus the plain-language qualifier (the parcel record).
export default function ConfidenceBadge({ confidence, department, size = 'compact' }) {
  const key = keyOf(confidence);
  const p = PROVENANCE[key];
  const detail = p.detail(department);
  return (
    <span className={`ls-prov ls-prov--${p.tone} ls-prov--${size}`} data-provenance={key} title={size === 'compact' ? detail : undefined}>
      <span className="ls-prov__label">
        <p.Icon className="ls-prov__icon" size={14} strokeWidth={2} aria-hidden="true" />
        {p.label}
      </span>
      {size === 'full' ? <span className="ls-prov__detail">{detail}</span> : <span className="sr-only">. {detail}</span>}
    </span>
  );
}

// Every state beside its meaning, for the parcel record and the map legend.
export function ProvenanceLegend({ states = ['verified', 'officer_provided', 'corrected_by_officer', 'stale', 'unverified', 'unverified_placeholder'] }) {
  return (
    <dl className="ls-prov-legend">
      {states.map((s) => (
        <div className="ls-prov-legend__row" key={s}>
          <dt><ConfidenceBadge confidence={s} /></dt>
          <dd>{PROVENANCE[s].detail()}</dd>
        </div>
      ))}
    </dl>
  );
}
