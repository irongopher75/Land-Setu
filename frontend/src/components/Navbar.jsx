import React, { useState, useEffect } from 'react';
import { checkSyncMode, getAllStates } from '../api';
import ParcelSearch from './ParcelSearch';

const ROLE_LABEL = {
  village_officer: 'Village Land Officer',
  auditor: 'Land Auditor',
  state_admin: 'State Admin Officer',
};

export default function Navbar({ activeView, setActiveView, selectedState, setSelectedState, currentRole, isLoggedIn, currentUser, onLogout, onOpenStateLogs, onOpenAnalytics, onSearchPick }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [states, setStates] = useState([]);

  useEffect(() => {
    let live = true;
    checkSyncMode().then((status) => live && setSyncStatus(status));
    getAllStates().then((list) => live && setStates(list));
    return () => { live = false; };
  }, []);

  const tab = (view, label) => (
    <button className={`tab-btn ${activeView === view ? 'active' : ''}`} aria-current={activeView === view ? 'page' : undefined} onClick={() => setActiveView(view)}>
      {label}
    </button>
  );

  return (
    <header className="navbar">
      <div className="nav-brand" onClick={() => setActiveView('landing')}>
        <span className="brand-title">LandSetu</span>
        {syncStatus && (
          <span className={`sync-pill ${syncStatus.isBackendConnected ? '' : 'is-offline'}`} title={syncStatus.label}>
            {syncStatus.isBackendConnected ? 'Live database' : 'Offline copy'}
          </span>
        )}
      </div>

      <div className="nav-controls">
        <div className="view-tabs">
          {tab('landing', 'Home')}
          {tab('map', 'Parcel map')}
          {currentRole === 'state_admin' && <button className="tab-btn" onClick={onOpenStateLogs}>State activity</button>}
          {currentRole === 'state_admin' && <button className="tab-btn" onClick={onOpenAnalytics}>Analytics</button>}
        </div>

        {activeView === 'map' && <ParcelSearch selectedState={selectedState} onPick={onSearchPick} />}

        {activeView === 'map' && (
          <label className="state-selector">
            State
            <select value={selectedState} onChange={(e) => setSelectedState(e.target.value)}>
              {states.map((s) => <option key={s.name} value={s.name}>{s.label} ({s.capital})</option>)}
            </select>
          </label>
        )}

        {isLoggedIn ? (
          <>
            <span className="role-tag">{ROLE_LABEL[currentRole] || 'Citizen'}</span>
            <span className="nav-user">{currentUser?.email || currentUser?.displayName || 'Signed in'}</span>
            <button className="tab-btn" onClick={onLogout}>Sign out</button>
          </>
        ) : (
          tab('login', 'Officer sign in')
        )}
      </div>
    </header>
  );
}
