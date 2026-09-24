import React from 'react';
import OfficerFrame from './OfficerFrame';
import AdapterDemo from '../../components/AdapterDemo';

export default function ImportPage({ role, isLoggedIn }) {
  return (
    <OfficerFrame title="Data import" path="/officer/import" role={role} isLoggedIn={isLoggedIn} allow={['state_admin']} wide>
      <section>
        <h2>How a state's records are brought in</h2>
        <table className="data-table">
          <thead><tr><th scope="col">Step</th><th scope="col">What happens</th><th scope="col">Status</th></tr></thead>
          <tbody>
            <tr><th scope="row">1. Upload</th><td>The state's export file is uploaded.</td><td><span className="badge self_declared">Not built</span></td></tr>
            <tr><th scope="row">2. Preview</th><td>The state's format is mapped to the common schema and shown side by side. Run it below.</td><td><span className="badge verified">Working</span></td></tr>
            <tr><th scope="row">3. Validate</th><td>Rows that fail the mapping are listed for correction.</td><td><span className="badge self_declared">Not built</span></td></tr>
            <tr><th scope="row">4. Commit</th><td>Valid rows are written to the parcel database with an audit entry.</td><td><span className="badge self_declared">Not built</span></td></tr>
          </tbody>
        </table>
      </section>
      <AdapterDemo />
    </OfficerFrame>
  );
}
