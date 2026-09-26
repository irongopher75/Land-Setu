import React from 'react';
import { CheckCircle2, AlertTriangle, Clock, HelpCircle } from 'lucide-react';

// Only an explicit 'verified' from the records service shows as verified. A missing or unknown value
// is never read as verified.
export default function ConfidenceBadge({ confidence }) {
  const value = String(confidence || 'unverified').toLowerCase();

  if (value === 'verified') {
    return (
      <span className="badge verified">
        <CheckCircle2 size={12} /> Verified
      </span>
    );
  }

  if (value === 'self_declared') {
    return (
      <span className="badge self_declared">
        <AlertTriangle size={12} /> Self-Declared
      </span>
    );
  }

  if (value === 'stale') {
    return (
      <span className="badge stale">
        <Clock size={12} /> Stale Data
      </span>
    );
  }

  if (value === 'unverified_placeholder') {
    return (
      <span className="badge stale">
        <HelpCircle size={12} /> Sample value, not verified
      </span>
    );
  }

  return (
    <span className="badge stale">
      <HelpCircle size={12} /> Not verified
    </span>
  );
}
