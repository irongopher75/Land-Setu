import React, { lazy, Suspense, useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import { logout } from './api';
import { auth, signOut as firebaseSignOut, onAuthStateChanged } from './firebase';

const LoginPage = lazy(() => import('./components/LoginPage'));
const MapView = lazy(() => import('./components/MapView'));
const ParcelPanel = lazy(() => import('./components/ParcelPanel'));
const StateLogModal = lazy(() => import('./components/StateLogModal'));
const CitizenServiceTrackerModal = lazy(() => import('./components/CitizenServiceTrackerModal'));
const SatelliteAiChangeDetectionModal = lazy(() => import('./components/SatelliteAiChangeDetectionModal'));
const AuditLogModal = lazy(() => import('./components/AuditLogModal'));

export default function App() {
  const [activeView, setActiveView] = useState('landing');
  const [selectedState, setSelectedState] = useState('TamilNadu');
  const [selectedUlpin, setSelectedUlpin] = useState(null);
  const [editingParcel, setEditingParcel] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState(() => localStorage.getItem('landsetu_role') || 'citizen');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Modals
  const [showStateLogs, setShowStateLogs] = useState(false);
  const [showCitizenTracker, setShowCitizenTracker] = useState(false);
  const [showSatelliteAi, setShowSatelliteAi] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [fallbackToast, setFallbackToast] = useState(null);

  // Monitor Network Fallbacks
  useEffect(() => {
    const onFallback = (e) => {
      setFallbackToast(e.detail);
      setTimeout(() => setFallbackToast(null), 4000);
    };
    window.addEventListener('landsetu-fallback-notice', onFallback);
    return () => window.removeEventListener('landsetu-fallback-notice', onFallback);
  }, []);

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
      {fallbackToast && (
        <div style={{
          position: 'fixed',
          top: '70px',
          right: '20px',
          zIndex: 3000,
          background: 'rgba(30, 41, 59, 0.95)',
          border: '1px solid #38bdf8',
          color: '#f8fafc',
          padding: '10px 16px',
          borderRadius: '10px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backdropFilter: 'blur(8px)',
          animation: 'slideUp 0.3s ease'
        }}>
          <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>⚡ Offline Demo Resilience Mode:</span>
          <span>{fallbackToast.actionName} fallback triggered at {fallbackToast.time}</span>
        </div>
      )}
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
        onOpenStateLogs={() => setShowStateLogs(true)}
        onOpenCitizenTracker={() => setShowCitizenTracker(true)}
        onOpenSatelliteAi={() => setShowSatelliteAi(true)}
        onOpenAuditLog={() => setShowAuditLog(true)}
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
                onDeletionRequested={() => setSelectedUlpin(null)}
              />
            )}
          </>
        )}

        {showStateLogs && (
          <StateLogModal
            initialState={selectedState}
            role={currentRole}
            onClose={() => setShowStateLogs(false)}
          />
        )}

        {showCitizenTracker && (
          <CitizenServiceTrackerModal
            initialUlpin={selectedUlpin}
            onClose={() => setShowCitizenTracker(false)}
          />
        )}

        {showSatelliteAi && (
          <SatelliteAiChangeDetectionModal
            ulpin={selectedUlpin}
            state={selectedState}
            onClose={() => setShowSatelliteAi(false)}
          />
        )}

        {showAuditLog && (
          <AuditLogModal
            stateFilter={selectedState}
            role={currentRole}
            onClose={() => setShowAuditLog(false)}
          />
        )}
        </Suspense>
      </main>
    </div>
  );
}
