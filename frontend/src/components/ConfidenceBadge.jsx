import React from 'react';
import { CheckCircle2, AlertTriangle, Clock, HelpCircle, Pencil, UserCheck } from 'lucide-react';

// Only an explicit 'verified' from the records service shows as verified. A missing or unknown value
// is never read as verified.
export default function ConfidenceBadge({ confidence, department }) {
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

  // Entered by the officer who approved a new parcel. Real, disclosed data, not a department record.
  if (value === 'officer_provided') {
    const dept = department || 'the department';
    return (
      <span className="badge officer" title={`Entered by the officer who approved this parcel. ${dept} has not confirmed it.`}>
        <UserCheck size={12} /> Provided by reviewing officer, not independently confirmed by {dept}
      </span>
    );
  }

  // Reviewed and approved by officers, but not confirmed by the department's own record.
  if (value === 'corrected_by_officer') {
    return (
      <span className="badge corrected" title="An officer-approved correction changed this record. No department record confirms it yet.">
        <Pencil size={12} /> Corrected by officer, not independently confirmed
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
