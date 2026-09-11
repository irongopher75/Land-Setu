import React, { lazy, Suspense, useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import { logout } from './api';
import { auth, signOut as firebaseSignOut, onAuthStateChanged } from './firebase';

const LoginPage = lazy(() => import('./components/LoginPage'));
const MapView = lazy(() => import('./components/MapView'));
const ParcelPanel = lazy(() => import('./components/ParcelPanel'));
const AdapterDemo = lazy(() => import('./components/AdapterDemo'));

export default function App() {
  const [activeView, setActiveView] = useState('landing');
  const [selectedState, setSelectedState] = useState('TamilNadu');
  const [selectedUlpin, setSelectedUlpin] = useState(null);
  const [editingParcel, setEditingParcel] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState('citizen');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Monitor Firebase Auth State & Auto Redirect to Map View
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        setIsLoggedIn(true);
        setActiveView((prev) => (prev === 'login' || prev === 'landing' ? 'map' : prev));
      } else {
        setCurrentUser(null);
        setIsLoggedIn(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleRoleChange = (newRole) => {
    setCurrentRole(newRole);
    if (newRole === 'citizen' && activeView === 'adapter') {
      setActiveView('map');
    }
  };

  const handleLoginSuccess = (role, user) => {
    setCurrentRole(role);
    if (user) setCurrentUser(user);
    setIsLoggedIn(true);
    setActiveView('map');
  };

  const handleLogout = () => {
    firebaseSignOut(auth).catch(() => {});
    logout().catch(() => {});
    setIsLoggedIn(false);
    setCurrentUser(null);
    setActiveView('landing');
  };

  const handleReshapeBoundary = (parcelData) => {
    setEditingParcel(parcelData);
    setSelectedUlpin(null);
  };

  return (
    <div className="app-container">
      <Navbar
        activeView={activeView}
        setActiveView={setActiveView}
        selectedState={selectedState}
        setSelectedState={setSelectedState}
        currentRole={currentRole}
        onRoleChange={handleRoleChange}
        isLoggedIn={isLoggedIn}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      <main className="main-content">
        <Suspense fallback={<div style={{ padding: '2rem', color: '#fff' }}>Loading…</div>}>
        {activeView === 'landing' && (
          <LandingPage
            onLaunchMap={() => setActiveView('map')}
            onLoginClick={() => setActiveView('login')}
          />
        )}

        {activeView === 'login' && (
          <LoginPage
            onLoginSuccess={handleLoginSuccess}
            onExploreDemo={() => setActiveView('map')}
          />
        )}

        {activeView === 'map' && (
          <>
            <MapView
              selectedState={selectedState}
              selectedUlpin={selectedUlpin}
              onSelectParcel={(ulpin) => setSelectedUlpin(ulpin)}
              editingParcel={editingParcel}
              onClearEditingParcel={() => setEditingParcel(null)}
              onAutoDetectState={(newState) => setSelectedState(newState)}
              role={currentRole}
            />
            {selectedUlpin && (
              <ParcelPanel
                ulpin={selectedUlpin}
                role={currentRole}
                onClose={() => setSelectedUlpin(null)}
                onReshapeBoundary={handleReshapeBoundary}
              />
            )}
          </>
        )}

        {activeView === 'adapter' && currentRole !== 'citizen' && <AdapterDemo />}
        </Suspense>
      </main>
    </div>
  );
}
