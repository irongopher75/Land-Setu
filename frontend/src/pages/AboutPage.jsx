import React from 'react';
import PageShell from '../components/PageShell';

export default function AboutPage() {
  return (
    <PageShell title="About this platform">
      <section>
        <h2>What LandSetu does</h2>
        <p>Land records in India sit in separate registers: the Record of Rights with the revenue department, the deed with the Sub-Registrar, the zoning map with town planning, the permit with the municipal body, and the tax roll with revenue. Each uses its own format and its own identifier.</p>
        <p>LandSetu reads these registers against a single parcel number (ULPIN), shows them side by side, and marks where they disagree. It reads records. It does not decide who owns a parcel.</p>
      </section>
      <section>
        <h2>Who built it and why</h2>
        <p>LandSetu was built by Team Logic Lords for Smart India Hackathon problem statement SIH26014, which asks for a way to bring fragmented land records from different states into one view. It is a prototype. It is not operated by, or affiliated with, any government department.</p>
      </section>
      <section>
        <h2>Current status</h2>
        <table className="data-table">
          <tbody>
            <tr><th scope="row">Stage</th><td>Working prototype</td></tr>
            <tr><th scope="row">Data</th><td>Synthetic. No real parcel, owner or identifier appears anywhere.</td></tr>
            <tr><th scope="row">Areas loaded</th><td>Chennai (Tamil Nadu) and Sector 17 (Chandigarh)</td></tr>
            <tr><th scope="row">Legal standing</th><td>None. Nothing shown here is a legal record.</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2>What is shown for each field</h2>
        <p>Every field carries the department it came from and a label: verified, self-declared or stale. See <a href="#/how-it-works">How it works</a>.</p>
      </section>
    </PageShell>
  );
}
