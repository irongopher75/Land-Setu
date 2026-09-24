import React from 'react';
import OfficerFrame from './OfficerFrame';
import ApprovalQueueModal from '../../components/ApprovalQueueModal';
import { navigate } from '../../router';

export default function QueuePage({ role, isLoggedIn }) {
  return (
    <OfficerFrame title="Approval queue" path="/officer/queue" role={role} isLoggedIn={isLoggedIn} wide>
      <ApprovalQueueModal role={role} onClose={() => navigate('/officer')} />
    </OfficerFrame>
  );
}
