import React from 'react';
import PageShell from '../components/PageShell';

const ROWS = [
  ['GET', '/parcels/states/all', 'States with parcel data', 'Public'],
  ['GET', '/parcels?state=', 'List parcels in a state', 'Public'],
  ['GET', '/parcels/search?q=', 'Search by ULPIN, owner name or khata number', 'Public'],
  ['GET', '/parcels/geojson/all?state=', 'All parcel boundaries for a state', 'Public'],
  ['GET', '/parcels/protected-zones/geojson', 'Notified protected zones', 'Public'],
  ['GET', '/parcels/{ulpin}', 'Full record: five department layers and flags', 'Public'],
  ['GET', '/parcels/{ulpin}/geometry', 'Boundary of one parcel', 'Public'],
  ['GET', '/parcels/{ulpin}/flags', 'Rule flags with the evidence behind each', 'Public'],
  ['GET', '/parcels/{ulpin}/history', 'Dated events: transfers, registration, permits, tax, requests', 'Public'],
  ['GET', '/parcels/{ulpin}/passport', 'Signed parcel passport for the QR code', 'Public'],
  ['POST', '/parcels/{ulpin}/correction-request', 'Request a record correction', 'Signed in'],
  ['POST', '/parcels/{ulpin}/split-request', 'Propose a split', 'Officer'],
  ['POST', '/parcels/{ulpin}/merge-request', 'Propose a merge', 'Officer'],
  ['GET', '/parcels/requests/pending', 'Open requests', 'Officer'],
  ['GET', '/parcels/analytics/summary', 'Counts by state', 'State admin'],
  ['POST', '/adapter/preview', 'Map a state record to the common schema', 'Officer'],
];

export default function DevelopersPage() {
  return (
    <PageShell title="Developer API">
      <div className="callout"><strong>Prototype API.</strong> The endpoints below exist in the prototype backend and may change. No keys are issued and no public service is hosted.</div>
      <p>LandSetu is designed as shared infrastructure: banks, courts and other state systems should be able to read the same reconciled record. Every response carries the source department and a confidence label for each field.</p>
      <table className="data-table">
        <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">Returns</th><th scope="col">Access</th></tr></thead>
        <tbody>
          {ROWS.map(([m, p, d, a]) => (
            <tr key={m + p}><td><span className="data-id">{m}</span></td><td><span className="data-id">{p}</span></td><td>{d}</td><td>{a}</td></tr>
          ))}
        </tbody>
      </table>
      <section>
        <h2>Example</h2>
        <pre className="code-box">{`GET /parcels/TN-CHN-0042-1187

{
  "ulpin": "TN-CHN-0042-1187",
  "state": "TamilNadu",
  "area_sqm": 452.3,
  "layers": {
    "ror": { "owner_name": "R. Kannan", "source": "revenue_dept", "confidence": "verified" },
    "registration": { ... }, "zoning": { ... }, "building_permit": { ... }, "tax": { ... },
    "encumbrance": { "active": false, ... }
  },
  "flags": []
}`}</pre>
      </section>
      <section>
        <h2>Planned for the pilot phase</h2>
        <ul className="plain-list">
          <li>Issued API keys with per-key rate limits.</li>
          <li>A versioned path such as /v1 and a published change log.</li>
          <li>A hosted sandbox with the synthetic data. The API already publishes an OpenAPI description at /openapi.json.</li>
        </ul>
      </section>
    </PageShell>
  );
}
