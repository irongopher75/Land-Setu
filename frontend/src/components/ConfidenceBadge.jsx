import React from 'react';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

export default function ConfidenceBadge({ confidence }) {
  const value = (confidence || 'verified').toLowerCase();

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

  return (
    <span className="badge verified">
      <CheckCircle2 size={12} /> {confidence}
    </span>
  );
}
