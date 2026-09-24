import React from 'react';
import PageShell from '../components/PageShell';

export default function HowItWorksPage() {
  return (
    <PageShell title="How it works">
      <section>
        <h2>Five registers, one parcel</h2>
        <p>Each department keeps its own register, in its own format, under its own identifier. A buyer, a bank or a court has to visit all five and reconcile them by hand.</p>
        <table className="data-table ledger-table">
          <thead><tr><th scope="col">Department</th><th scope="col">Register</th><th scope="col">Answers</th><th scope="col">Typical gap</th></tr></thead>
          <tbody>
            <tr><th scope="row">Revenue</th><td>Record of Rights, khata</td><td>Who is the owner of record</td><td>Owner not updated after sale</td></tr>
            <tr><th scope="row">Sub-Registrar</th><td>Deed of registration</td><td>Who bought it, and when</td><td>Deed buyer differs from RoR owner</td></tr>
            <tr><th scope="row">Town planning</th><td>Master plan zoning</td><td>What may be built, at what FSI</td><td>Permit approved above the limit</td></tr>
            <tr><th scope="row">Municipal corporation</th><td>Building permit</td><td>What was approved</td><td>Permit issued inside a protected zone</td></tr>
            <tr><th scope="row">Revenue, tax</th><td>Property tax roll</td><td>Who pays, on what value</td><td>Assessment years out of date</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2>Checks run on every parcel</h2>
        <ol className="checks-list">
          <li><span className="checks-name">Boundary overlap</span><span>Interiors that intersect another parcel in the same state, with the shared area in square metres.</span></li>
          <li><span className="checks-name">Protected zone</span><span>Any intersection with a notified eco-sensitive area, named with its zone id.</span></li>
          <li><span className="checks-name">Ownership mismatch</span><span>Record of Rights owner against Sub-Registrar buyer, shown side by side.</span></li>
          <li><span className="checks-name">FSI violation</span><span>Approved permit FSI against the zoning limit, with the excess.</span></li>
          <li><span className="checks-name">Active encumbrance</span><span>Mortgage or legal charge registered against the parcel.</span></li>
        </ol>
      </section>
      <section>
        <h2>What the labels mean</h2>
        <dl className="roles-list">
          <div><dt><span className="badge verified">Verified</span></dt><dd>Confirmed by the department that holds the register.</dd></div>
          <div><dt><span className="badge self_declared">Self-declared</span></dt><dd>Stated by the owner or applicant. Not yet confirmed by a department.</dd></div>
          <div><dt><span className="badge stale">Stale</span></dt><dd>The last confirmation is old enough that the value may have changed.</dd></div>
        </dl>
      </section>
      <section>
        <h2>How a correction is made</h2>
        <p>Anyone can request a correction with a supporting document. The request passes three stages. No one can approve their own request, and every decision is written to a tamper-evident log.</p>
        <ol className="checks-list">
          <li><span className="checks-name">Village land officer</span><span>Checks the documents against the field record.</span></li>
          <li><span className="checks-name">Auditor</span><span>Reviews the officer's decision independently.</span></li>
          <li><span className="checks-name">State administrator</span><span>Gives final approval. The record changes only after this stage.</span></li>
        </ol>
      </section>
    </PageShell>
  );
}
