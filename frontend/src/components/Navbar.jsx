import React, { useState, useEffect } from 'react';
import { getAllStates } from '../api';
import ParcelSearch from './ParcelSearch';

const ROLE_LABEL = {
  village_officer: 'Village Land Officer',
  auditor: 'Land Auditor',
  state_admin: 'State Admin Officer',
};

export default function Navbar({ activeView, setActiveView, selectedState, setSelectedState, currentRole, isLoggedIn, currentUser, onLogout, onOpenStateLogs, onOpenAnalytics, onSearchPick }) {
  const [states, setStates] = useState([]);

  useEffect(() => {
    let live = true;
    getAllStates().then((list) => live && setStates(list));
    return () => { live = false; };
  }, []);

  const tab = (view, label) => (
    <button className={`tab-btn ${activeView === view ? 'active' : ''}`} aria-current={activeView === view ? 'page' : undefined} onClick={() => setActiveView(view)}>
      {label}
    </button>
  );

  const initial = String(currentUser?.displayName || currentUser?.email || 'U').trim().charAt(0).toUpperCase();

  return (
    <header className="navbar">
      <div className="nav-brand" onClick={() => setActiveView('landing')}>
        <span className="brand-title">LandSetu</span>
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
            <details className="profile-menu">
              <summary aria-label="Account menu"><span className="avatar" aria-hidden="true">{initial}</span></summary>
              <div className="profile-pop">
                <div className="profile-name">{currentUser?.displayName || 'Signed in'}</div>
                {currentUser?.email && <div className="subtle">{currentUser.email}</div>}
                <div className="subtle">{ROLE_LABEL[currentRole] || 'Citizen'}</div>
                <button className="btn btn--block" onClick={onLogout}>Sign out</button>
              </div>
            </details>
          </>
        ) : (
          tab('login', 'Sign in')
        )}
      </div>
    </header>
  );
}
