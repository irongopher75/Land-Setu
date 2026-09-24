import React from 'react';
import OfficerFrame from './OfficerFrame';
import AnalyticsDashboard from '../../components/AnalyticsDashboard';
import { navigate } from '../../router';

export default function AnalyticsPage({ role, isLoggedIn }) {
  return (
    <OfficerFrame title="State analytics" path="/officer/analytics" role={role} isLoggedIn={isLoggedIn} allow={['state_admin']} wide>
      <AnalyticsDashboard onClose={() => navigate('/officer')} />
    </OfficerFrame>
  );
}
