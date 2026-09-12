import React, { lazy, Suspense, useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import { logout } from './api';
import { auth, signOut as firebaseSignOut, onAuthStateChanged } from './firebase';

const LoginPage = lazy(() => import('./components/LoginPage'));
const MapView = lazy(() => import('./components/MapView'));
const ParcelPanel = lazy(() => import('./components/ParcelPanel'));

export default function App() {
  const [activeView, setActiveView] = useState('landing');
  const [selectedState, setSelectedState] = useState('TamilNadu');
  const [selectedUlpin, setSelectedUlpin] = useState(null);
  const [editingParcel, setEditingParcel] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState(() => localStorage.getItem('landsetu_role') || 'citizen');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Monitor Firebase Auth State & Auto Redirect to Map View
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        setIsLoggedIn(true);
        const savedRole = localStorage.getItem('landsetu_role');
        if (savedRole) {
          setCurrentRole(savedRole);
        }
        setActiveView((prev) => (prev === 'login' || prev === 'landing' ? 'map' : prev));
      } else {
        setCurrentUser(null);
        setIsLoggedIn(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLoginSuccess = (role, user) => {
    localStorage.setItem('landsetu_role', role);
    setCurrentRole(role);
    if (user) setCurrentUser(user);
    setIsLoggedIn(true);
    setActiveView('map');
  };

  const handleLogout = () => {
    localStorage.removeItem('landsetu_role');
    firebaseSignOut(auth).catch(() => {});
    logout().catch(() => {});
    setIsLoggedIn(false);
    setCurrentUser(null);
    setCurrentRole('citizen');
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
        setCurrentRole={(newRole) => {
          localStorage.setItem('landsetu_role', newRole);
          setCurrentRole(newRole);
        }}
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
        </Suspense>
      </main>
    </div>
  );
}
