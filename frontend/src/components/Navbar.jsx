import React, { useState, useEffect } from 'react';
import { getAllStates, getRoleDiagnostic } from '../api';
import ParcelSearch from './ParcelSearch';
import { LANGUAGES, useT } from '../i18n';
import { ROLE_LABEL, can } from '../roles';


const LINKS = [
  { view: 'landing', path: '/', key: 'nav.home' },
  { view: 'search', path: '/search', key: 'nav.search' },
  { view: 'map', path: '/map', key: 'nav.map' },
  { view: 'how-it-works', path: '/how-it-works', key: 'nav.how' },
  { view: 'coverage', path: '/coverage', key: 'nav.coverage' },
  { view: 'services', path: '/services', key: 'nav.services' },
  { view: 'faq', path: '/faq', key: 'nav.help' },
  { view: 'grievance', path: '/grievance', key: 'nav.grievance' },
];

export default function Navbar({ activeView, selectedState, setSelectedState, currentRole, isLoggedIn, currentUser, onLogout, onOpenStateLogs, onOpenAnalytics, onSearchPick }) {
  const { t, lang, setLang } = useT();
  const [states, setStates] = useState([]);

  useEffect(() => {
    let live = true;
    getAllStates().then((list) => live && setStates(list));
    return () => { live = false; };
  }, []);

  const initial = String(currentUser?.displayName || currentUser?.email || 'U').trim().charAt(0).toUpperCase();

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">{t('skip')}</a>
      <div className="navbar">
        <a className="nav-brand" href="#/" aria-label="LandSetu home">
          <span className="brand-title">LandSetu</span>
          <span className="brand-sub">Land records portal</span>
        </a>

        <div className="nav-controls">
          {activeView === 'map' && <ParcelSearch selectedState={selectedState} onPick={onSearchPick} />}

          {activeView === 'map' && (
            <label className="state-selector">
              State
              <select value={selectedState} onChange={(e) => setSelectedState(e.target.value)}>
                {states.map((s) => <option key={s.name} value={s.name}>{s.label} ({s.capital})</option>)}
              </select>
            </label>
          )}

          <label className="state-selector">
            <span className="sr-only">{t('lang.label')}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('lang.label')}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>

          {isLoggedIn ? (
            <>
              <span className="role-tag">{ROLE_LABEL[currentRole] || 'Citizen'}</span>
              <details className="profile-menu">
                <summary aria-label="Account menu"><span className="avatar" aria-hidden="true">{initial}</span></summary>
                <div className="profile-pop">
                  <div className="profile-name">{currentUser?.displayName || 'Signed in'}</div>
                  {currentUser?.email && <div className="subtle">{currentUser.email}</div>}
                  <div className="subtle">{ROLE_LABEL[currentRole] || 'Citizen'}</div>
                  <div className="subtle">Role source: {getRoleDiagnostic().source}</div>
                  <button className="btn btn--block" onClick={onLogout}>{t('nav.signout')}</button>
                </div>
              </details>
            </>
          ) : (
            <a className={`btn ${activeView === 'login' ? 'btn--primary' : ''}`} href="#/login">{t('nav.signin')}</a>
          )}
        </div>
      </div>

      <nav className="site-nav" aria-label="Primary">
        <ul>
          {LINKS.map((l) => (
            <li key={l.view}>
              <a href={`#${l.path}`} aria-current={activeView === l.view ? 'page' : undefined} className={activeView === l.view ? 'active' : ''}>{t(l.key)}</a>
            </li>
          ))}
          {isLoggedIn && currentRole === 'bank' && (
            <li><a href="#/bank" className={activeView === 'bank' ? 'active' : ''} aria-current={activeView === 'bank' ? 'page' : undefined}>Lender checks</a></li>
          )}
          {isLoggedIn && can(currentRole, 'officerConsole') && (
            <li><a href="#/officer" className={activeView.startsWith('officer') ? 'active' : ''} aria-current={activeView.startsWith('officer') ? 'page' : undefined}>Officer console</a></li>
          )}
          {(currentRole === 'state_admin' || currentRole === 'super_admin') && isLoggedIn && <li><button className="tab-btn" onClick={onOpenStateLogs}>State activity</button></li>}
        </ul>
      </nav>
    </header>
  );
}
