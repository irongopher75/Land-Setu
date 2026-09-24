import React from 'react';
import OfficerFrame from './OfficerFrame';

export default function UsersPage({ role, isLoggedIn }) {
  return (
    <OfficerFrame title="Users and roles" path="/officer/users" role={role} isLoggedIn={isLoggedIn} allow={['state_admin']}>
      <div className="callout"><strong>Planned for the pilot phase.</strong> This page is not built in the prototype.</div>
      <section>
        <h2>What it will do</h2>
        <ul className="plain-list">
          <li>List the accounts in your state with their role and last sign-in.</li>
          <li>Assign or remove village officer, auditor and state administrator roles.</li>
          <li>Suspend an account without deleting its history.</li>
          <li>Record every role change in the audit log.</li>
        </ul>
      </section>
      <section>
        <h2>How roles are set today</h2>
        <p>The role is a claim on the account, set by an administrator with the command-line script in the repository (<span className="data-id">backend/scripts/set_role.py</span>). The server reads the role from that claim and nothing else.</p>
      </section>
    </OfficerFrame>
  );
}
