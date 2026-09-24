import React from 'react';
import PageShell from '../components/PageShell';

export default function CoveragePage() {
  return (
    <PageShell title="Where records are available">
      <table className="data-table">
        <thead><tr><th scope="col">State</th><th scope="col">Area</th><th scope="col">Status</th></tr></thead>
        <tbody>
          <tr><th scope="row">Tamil Nadu</th><td>Chennai, Nemili Revenue Village</td><td><span className="badge verified">Sample records loaded</span></td></tr>
          <tr><th scope="row">Chandigarh</th><td>Sector 17</td><td><span className="badge verified">Sample records loaded</span></td></tr>
          <tr><th scope="row">Other states</th><td>Record format mapped, no parcels loaded</td><td><span className="badge self_declared">Not available yet</span></td></tr>
        </tbody>
      </table>
      <p>All parcels, owners and identifiers are synthetic. None describes a real person or property.</p>
      <section>
        <h2>Adding a state</h2>
        <p>Each state publishes its records in its own format. LandSetu maps a format to one common schema with a written configuration, so a new state needs a mapping and a data load. It does not need new software.</p>
      </section>
    </PageShell>
  );
}
