import React from 'react';
import { Map, MapPin, Home, LogIn, Lock } from 'lucide-react';

export default function Navbar({ activeView, setActiveView, selectedState, setSelectedState, currentRole, isLoggedIn, currentUser, onLogout }) {
  const getRoleLabel = (role) => {
    switch (role) {
      case 'village_officer': return '🏛️ Village Land Officer';
      case 'auditor': return '🔍 Land Auditor';
      case 'state_admin': return '🛡️ State Admin Officer';
      default: return '👤 Citizen Access';
    }
  };

  return (
    <header className="navbar">
      <div className="nav-brand" style={{ cursor: 'pointer' }} onClick={() => setActiveView('landing')}>
        <div className="brand-icon">
          <MapPin color="#fff" size={22} />
        </div>
        <div>
          <span className="brand-title">LandSetu</span>
        </div>
      </div>

      <div className="nav-controls">
        {/* View Switcher Tabs */}
        <div className="view-tabs">
          <button
            className={`tab-btn ${activeView === 'landing' ? 'active' : ''}`}
            onClick={() => setActiveView('landing')}
          >
            <Home size={15} /> Home
          </button>

          <button
            className={`tab-btn ${activeView === 'map' ? 'active' : ''}`}
            onClick={() => setActiveView('map')}
          >
            <Map size={15} /> GIS Map View
          </button>
        </div>

        {/* State Focus Shortcut */}
        {activeView === 'map' && (
          <div className="state-selector">
            <span>State:</span>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
            >
              <option value="TamilNadu">Tamil Nadu (Chennai)</option>
              <option value="Chandigarh">Chandigarh</option>
              <option value="Maharashtra">Maharashtra (Mumbai)</option>
              <option value="Karnataka">Karnataka (Bengaluru)</option>
              <option value="Delhi">Delhi (NCT)</option>
              <option value="Telangana">Telangana (Hyderabad)</option>
              <option value="Kerala">Kerala (Kochi)</option>
              <option value="WestBengal">West Bengal (Kolkata)</option>
              <option value="Gujarat">Gujarat (Ahmedabad)</option>
              <option value="Rajasthan">Rajasthan (Jaipur)</option>
              <option value="UttarPradesh">Uttar Pradesh (Lucknow)</option>
              <option value="Punjab">Punjab (Ludhiana)</option>
              <option value="MadhyaPradesh">Madhya Pradesh (Bhopal)</option>
            </select>
          </div>
        )}

        {isLoggedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700, color: '#0369a1' }} title="Role is locked during session. Sign out to switch roles.">
              <Lock size={12} color="#0369a1" />
              <span>{getRoleLabel(currentRole)} (Locked)</span>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-main)', fontWeight: 600 }}>
              {currentUser?.email || currentUser?.displayName || 'Session Active'}
            </span>
            <button
              onClick={onLogout}
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#dc2626',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button
            className={`tab-btn ${activeView === 'login' ? 'active' : ''}`}
            style={{ background: activeView === 'login' ? 'var(--accent-primary)' : '#e2e8f0', border: '1px solid var(--border-card)', color: activeView === 'login' ? '#fff' : 'var(--text-main)', fontWeight: 700 }}
            onClick={() => setActiveView('login')}
          >
            <LogIn size={15} /> Sign In / Officer Login
          </button>
        )}
      </div>
    </header>
  );
}
