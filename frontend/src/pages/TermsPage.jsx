import React from 'react';
import PageShell from '../components/PageShell';

export default function TermsPage() {
  return (
    <PageShell title="Terms of use" draft>
      <h2>1. What this service is</h2>
      <p>LandSetu is a prototype built for Smart India Hackathon problem statement SIH26014. It is not a government service and is not operated by any government department.</p>
      <h2>2. No legal record</h2>
      <p>All parcels, owners, identifiers and documents shown are synthetic. Nothing on this site is a land record, a title, an encumbrance certificate or legal advice. Do not rely on it for any transaction.</p>
      <h2>3. Acceptable use</h2>
      <p>Use the service to explore the prototype. Do not attempt to gain access to accounts, data or systems you are not given access to. Do not enter real personal data or real land records.</p>
      <h2>4. Accounts</h2>
      <p>Officer roles are assigned by an administrator. You may not act in a role that has not been assigned to your account.</p>
      <h2>5. No warranty</h2>
      <p>The service is provided as it is. It may change, be unavailable, or be withdrawn without notice.</p>
      <h2>6. Contact</h2>
      <p>Questions about these terms: grievance@landsetu-demo.example (placeholder).</p>
    </PageShell>
  );
}
