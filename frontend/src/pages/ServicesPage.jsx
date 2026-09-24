import React from 'react';
import PageShell from '../components/PageShell';

export default function ServicesPage() {
  return (
    <PageShell title="For land officers">
      <p>Officer accounts are issued by the state land records office. The role on an account is set by the server. It cannot be chosen at sign-in.</p>
      <table className="data-table">
        <thead><tr><th scope="col">Role</th><th scope="col">Can do</th><th scope="col">Cannot do</th></tr></thead>
        <tbody>
          <tr><th scope="row">Citizen</th><td>Search parcels, read records, request a correction</td><td>Change any record</td></tr>
          <tr><th scope="row">Village land officer</th><td>Verify corrections, file boundary edits, splits and merges</td><td>Give final approval</td></tr>
          <tr><th scope="row">Auditor</th><td>Review every request before it reaches the state, authorize deletions</td><td>File a request and approve it</td></tr>
          <tr><th scope="row">State administrator</th><td>Give final approval, request deletions, read state-wide counts</td><td>Approve a deletion they filed</td></tr>
          <tr><th scope="row">Super administrator</th><td>Everything above, at every stage. Create accounts and assign roles. Every change is logged.</td><td>Change their own role, or remove the last super administrator</td></tr>
        </tbody>
      </table>
      <p><a className="btn btn--primary" href="#/login">Officer sign in</a></p>
    </PageShell>
  );
}
