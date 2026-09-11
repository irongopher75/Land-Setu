import React from 'react';
import { Map, Cpu, MapPin } from 'lucide-react';
import RoleSwitcher from './RoleSwitcher';

export default function Navbar({ activeView, setActiveView, selectedState, setSelectedState, onRoleChange }) {
  return (
    <header className="navbar">
      <div className="nav-brand">
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
            className={`tab-btn ${activeView === 'map' ? 'active' : ''}`}
            onClick={() => setActiveView('map')}
          >
            <Map size={16} /> GIS Map View
          </button>
          <button
            className={`tab-btn ${activeView === 'adapter' ? 'active' : ''}`}
            onClick={() => setActiveView('adapter')}
          >
            <Cpu size={16} /> Adapter Sandbox
          </button>
        </div>

        {/* State Focus Shortcut */}
        {activeView === 'map' && (
          <div className="state-selector">
            <span>State Cluster:</span>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
            >
              <option value="TamilNadu">Tamil Nadu (Chennai)</option>
              <option value="Chandigarh">Chandigarh</option>
            </select>
          </div>
        )}

        {/* Role Switcher */}
        <RoleSwitcher onRoleChange={onRoleChange} />
      </div>
    </header>
  );
}
