import React from 'react';
import { Map, Cpu, MapPin, Home, LogIn } from 'lucide-react';
import RoleSwitcher from './RoleSwitcher';

export default function Navbar({ activeView, setActiveView, selectedState, setSelectedState, currentRole, onRoleChange, isLoggedIn, currentUser, onLogout }) {
  return (
    <header className="navbar">
      <div className="nav-brand" style={{ cursor: 'pointer' }} onClick={() => setActiveView('landing')}>
        <div className="brand-icon">
          <MapPin color="#fff" size={22} />
        </div>
        <div>
          <span className="brand-title">LandSetu</span>
          <span className="brand-badge" style={{ marginLeft: '8px' }}>Sovereign GIS</span>
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

          {currentRole !== 'citizen' && (
            <button
              className={`tab-btn ${activeView === 'adapter' ? 'active' : ''}`}
              onClick={() => setActiveView('adapter')}
            >
              <Cpu size={15} /> Adapter Sandbox
            </button>
          )}
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

        {/* Role Switcher & User Account Header */}
        <RoleSwitcher currentRole={currentRole} onRoleChange={onRoleChange} />

        {isLoggedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.78rem', color: '#60a5fa', fontWeight: 600 }}>
              {currentUser?.email || currentUser?.displayName || 'Firebase Verified'}
            </span>
            <button
              onClick={onLogout}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button
            className={`tab-btn ${activeView === 'login' ? 'active' : ''}`}
            style={{ background: activeView === 'login' ? 'var(--accent-primary)' : 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#fff' }}
            onClick={() => setActiveView('login')}
          >
            <LogIn size={15} /> Sign In
          </button>
        )}
      </div>
    </header>
  );
}
