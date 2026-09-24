import React from 'react';
import PageShell from '../components/PageShell';

export default function GrievancePage({ onRequestCorrection }) {
  return (
    <PageShell title="Grievance and contact">
      <section>
        <h2>A record is wrong</h2>
        <p>Request a correction with a supporting document. You can follow the request by ULPIN afterwards.</p>
        <button className="btn btn--primary" onClick={onRequestCorrection}>Request a record correction</button>
      </section>
      <section>
        <h2>Something else is wrong</h2>
        <table className="data-table">
          <tbody>
            <tr><th scope="row">Email</th><td>grievance@landsetu-demo.example (placeholder, no mailbox is monitored)</td></tr>
            <tr><th scope="row">Covers</th><td>Errors on this site, accessibility problems, privacy questions</td></tr>
            <tr><th scope="row">Response target</th><td>Not set for the prototype</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2>Escalation</h2>
        <ol className="checks-list">
          <li><span className="checks-name">Site contact</span><span>Write to the address above.</span></li>
          <li><span className="checks-name">Record disputes</span><span>A correction request is decided by the village officer, auditor and state administrator in turn. For a dispute over ownership, the competent revenue authority or a court decides. LandSetu does not.</span></li>
        </ol>
      </section>
    </PageShell>
  );
}
