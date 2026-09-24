import React from 'react';
import OfficerFrame from './OfficerFrame';
import AuditLogModal from '../../components/AuditLogModal';
import { navigate } from '../../router';

export default function AuditPage({ role, isLoggedIn, selectedState }) {
  return (
    <OfficerFrame title="Audit log" path="/officer/audit" role={role} isLoggedIn={isLoggedIn} wide>
      <AuditLogModal stateFilter={selectedState} role={role} onClose={() => navigate('/officer')} />
      <p className="subtle">The hash chain for a single parcel is on its record: open the parcel on the map and choose the title hash chain.</p>
    </OfficerFrame>
  );
}
