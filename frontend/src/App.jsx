import React, { useState } from 'react';
import Navbar from './components/Navbar';
import MapView from './components/MapView';
import ParcelPanel from './components/ParcelPanel';
import AdapterDemo from './components/AdapterDemo';

export default function App() {
  const [activeView, setActiveView] = useState('map');
  const [selectedState, setSelectedState] = useState('TamilNadu');
  const [selectedUlpin, setSelectedUlpin] = useState(null);
  const [currentRole, setCurrentRole] = useState(
    localStorage.getItem('landsetu_role') || 'officer'
  );

  const handleRoleChange = (newRole) => {
    setCurrentRole(newRole);
  };

  return (
    <div className="app-container">
      <Navbar
        activeView={activeView}
        setActiveView={setActiveView}
        selectedState={selectedState}
        setSelectedState={setSelectedState}
        onRoleChange={handleRoleChange}
      />

      <main className="main-content">
        {activeView === 'map' ? (
          <>
            <MapView
              selectedState={selectedState}
              selectedUlpin={selectedUlpin}
              onSelectParcel={(ulpin) => setSelectedUlpin(ulpin)}
            />
            {selectedUlpin && (
              <ParcelPanel
                ulpin={selectedUlpin}
                role={currentRole}
                onClose={() => setSelectedUlpin(null)}
              />
            )}
          </>
        ) : (
          <AdapterDemo />
        )}
      </main>
    </div>
  );
}
