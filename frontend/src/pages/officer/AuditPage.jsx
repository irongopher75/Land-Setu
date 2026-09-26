import React from 'react';
import OfficerFrame from './OfficerFrame';
import AuditLogViewer from '../../components/AuditLogViewer';

// Auditors and state administrators. The API enforces the same roles.
export default function AuditPage({ role, isLoggedIn }) {
  return (
    <OfficerFrame title="Audit log" path="/officer/audit" role={role} isLoggedIn={isLoggedIn} allow={['auditor', 'state_admin']} wide>
      <AuditLogViewer />
      <p className="subtle">To re-verify one parcel's hash chain, open the parcel on the map and choose Audit hash chain.</p>
    </OfficerFrame>
  );
}
