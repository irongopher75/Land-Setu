import React, { lazy, Suspense, useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import { logout, resolveRole } from './api';
import { auth, signOut as firebaseSignOut, onAuthStateChanged } from './firebase';

const LoginPage = lazy(() => import('./components/LoginPage'));
const MapView = lazy(() => import('./components/MapView'));
const ParcelPanel = lazy(() => import('./components/ParcelPanel'));
const StateLogModal = lazy(() => import('./components/StateLogModal'));
const CitizenServiceTrackerModal = lazy(() => import('./components/CitizenServiceTrackerModal'));
const SatelliteAiChangeDetectionModal = lazy(() => import('./components/SatelliteAiChangeDetectionModal'));
const AuditLogModal = lazy(() => import('./components/AuditLogModal'));
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));

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
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [restructure, setRestructure] = useState(null); // { mode: 'split' | 'merge', parcel }
  const [focusPoint, setFocusPoint] = useState(null);
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
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        setIsLoggedIn(true);
        resolveRole(user).then((role) => {
          localStorage.setItem('landsetu_role', role);
          setCurrentRole(role);
        });
        setActiveView((prev) => (prev === 'login' || prev === 'landing' ? 'map' : prev));
      } else {
        setCurrentUser(null);
        setIsLoggedIn(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // A parcel from another state must not stay open beside a different state's map.
  const changeState = (next) => {
    if (next === selectedState) return;
    setSelectedState(next);
    setSelectedUlpin(null);
  };

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

  const handleSearchPick = (hit) => {
    setActiveView('map');
    if (hit.state && hit.state !== selectedState) setSelectedState(hit.state);
    if (hit.centroid) setFocusPoint({ center: [hit.centroid[1], hit.centroid[0]], nonce: Date.now() });
    setSelectedUlpin(hit.ulpin);
  };

  const handleStartRestructure = (mode, parcelData) => {
    setRestructure({ mode, parcel: parcelData });
    setSelectedUlpin(null);
  };

  const handleReshapeBoundary = (parcelData) => {
    setEditingParcel(parcelData);
    setSelectedUlpin(null);
  };

  return (
    <div className="app-container">
      {fallbackToast && (
        <div className="toast toast--top" role="status">
          <strong>Offline demo mode.</strong>
          <span>{fallbackToast.actionName} fell back to local data at {fallbackToast.time}</span>
        </div>
      )}
      <Navbar
        activeView={activeView}
        setActiveView={setActiveView}
        selectedState={selectedState}
        setSelectedState={changeState}
        currentRole={currentRole}
        setCurrentRole={(r) => {
          localStorage.setItem('landsetu_role', r);
          setCurrentRole(r);
        }}
        isLoggedIn={isLoggedIn}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenStateLogs={() => setShowStateLogs(true)}
        onOpenAnalytics={() => setShowAnalytics(true)}
        onSearchPick={handleSearchPick}
      />

      <main className="main-content">
        <Suspense fallback={<div className="fill-note">Loading.</div>}>
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
              onAutoDetectState={changeState}
              signedIn={isLoggedIn}
              role={currentRole}
              restructure={restructure}
              onRestructureClose={() => setRestructure(null)}
              focusPoint={focusPoint}
            />
            {selectedUlpin && (
              <ParcelPanel
                ulpin={selectedUlpin}
                role={currentRole}
                onClose={() => setSelectedUlpin(null)}
                onReshapeBoundary={handleReshapeBoundary}
                onDeletionRequested={() => setSelectedUlpin(null)}
                onStartRestructure={handleStartRestructure}
                onRequestCorrection={() => setShowCitizenTracker(true)}
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

        {showAnalytics && currentRole === 'state_admin' && (
          <AnalyticsDashboard onClose={() => setShowAnalytics(false)} />
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
