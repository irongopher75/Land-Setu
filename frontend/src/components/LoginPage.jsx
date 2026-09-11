import React, { useState } from 'react';
import { Lock, Mail, ArrowRight, ShieldCheck, ExternalLink, Info, CheckCircle2 } from 'lucide-react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  doc,
  setDoc
} from '../firebase';
import { mockLogin } from '../api';
import DigiLockerModal from './DigiLockerModal';

export default function LoginPage({ onLoginSuccess, onExploreDemo }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [role, setRole] = useState('citizen');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showConfigNotice, setShowConfigNotice] = useState(false);
  const [showDigiLocker, setShowDigiLocker] = useState(false);

  // Sync user profile to Firestore
  const syncUserToFirestore = async (user, userRole) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        role: userRole,
        photoURL: user.photoURL || null,
        lastLogin: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.warn('Firestore sync notice:', err.message);
    }
  };

  // Firebase Email/Password Auth
  const handleEmailAuthSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setShowConfigNotice(false);

    const targetEmail = email || `user_${role}@landsetu.gov.in`;
    const targetPass = password || 'LandSetuPass2026!';

    try {
      let userCredential;
      if (isSignUp) {
        userCredential = await createUserWithEmailAndPassword(auth, targetEmail, targetPass);
      } else {
        userCredential = await signInWithEmailAndPassword(auth, targetEmail, targetPass);
      }

      const user = userCredential.user;
      await syncUserToFirestore(user, role);
      await mockLogin(role);
      onLoginSuccess(role, user);
    } catch (err) {
      console.error('Firebase Auth Notice:', err.code, err.message);
      if (err.code === 'auth/invalid-api-key' || err.code === 'auth/network-request-failed' || err.message.includes('API key') || err.code === 'auth/invalid-credential') {
        // Fallback demo sign in for unconfigured local environment
        await mockLogin(role);
        onLoginSuccess(role, { email: targetEmail, uid: `mock-${role}` });
      } else {
        setErrorMsg(err.message.replace('Firebase:', '').trim());
      }
    } finally {
      setLoading(false);
    }
  };

  // Firebase Google Sign-In
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg('');
    setShowConfigNotice(false);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      await syncUserToFirestore(user, role);
      await mockLogin(role);
      onLoginSuccess(role, user);
    } catch (err) {
      console.error('Google Sign-In Exception:', err.code, err.message);
      
      if (err.code === 'auth/cancelled-popup-request') {
        setErrorMsg('Google Sign-In request was cancelled. Please click "Continue with Google" again.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Sign-in popup was closed before completing. Please try again.');
      } else if (err.code === 'auth/invalid-api-key' || err.code === 'auth/unauthorized-domain' || err.code === 'auth/operation-not-allowed' || err.message.includes('API key')) {
        setShowConfigNotice(true);
      } else {
        setErrorMsg(err.message.replace('Firebase:', '').trim());
      }
    } finally {
      setLoading(false);
    }
  };

  const handleProceedGoogleDemo = async () => {
    await mockLogin(role);
    onLoginSuccess(role, { 
      email: 'google.user@landsetu.gov.in', 
      displayName: 'Google Verified User', 
      uid: 'google-demo-user' 
    });
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', position: 'relative', overflow: 'hidden' }}>
      {/* Background glow effects */}
      <div style={{ position: 'absolute', top: '20%', left: '30%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(0,0,0,0) 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '20%', right: '30%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(6,182,212,0.15) 0%, rgba(0,0,0,0) 70%)', pointerEvents: 'none' }} />

      <div className="modal-card" style={{ maxWidth: '450px', width: '100%', padding: '32px', position: 'relative', zIndex: 10 }}>
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(59,130,246,0.4)', marginBottom: '12px' }}>
            <ShieldCheck color="#fff" size={26} />
          </div>
          <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '1.6rem', color: '#fff' }}>
            {isSignUp ? 'Create LandSetu Account' : 'Welcome to LandSetu'}
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Project: <strong style={{ color: 'var(--accent-cyan)' }}>landsetu-e4e5e</strong> | Firebase Auth & Firestore
          </p>
        </div>

        {/* Google OAuth Notice / Helper */}
        {showConfigNotice && (
          <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '14px', borderRadius: '10px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#60a5fa', fontWeight: 700, fontSize: '0.85rem' }}>
              <Info size={16} /> Firebase Google Auth Notice
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-main)', lineHeight: 1.4 }}>
              To complete live Google OAuth popup, paste your Web API Key into <code>frontend/.env</code> and enable <strong>Google Sign-In</strong> in Firebase Console (Authentication &gt; Sign-in method).
            </p>
            <button
              type="button"
              className="passport-btn"
              style={{ width: '100%', padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #2563eb, #0284c7)', marginTop: '4px' }}
              onClick={handleProceedGoogleDemo}
            >
              Proceed as Google User (Demo Mode) →
            </button>
          </div>
        )}

        {errorMsg && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', marginTop: '12px' }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {/* Federated Sign-In Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '16px 0' }}>
          {/* Google Sign-In Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            style={{
              width: '100%',
              padding: '11px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid var(--border-card)',
              borderRadius: '10px',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.2s'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Continue with Google
          </button>

          {/* DigiLocker Button */}
          <button
            type="button"
            onClick={() => setShowDigiLocker(true)}
            style={{
              width: '100%',
              padding: '11px',
              background: 'linear-gradient(135deg, #1e3a8a, #0369a1)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              borderRadius: '10px',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}
          >
            <span style={{ background: '#fff', color: '#1e3a8a', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
              DigiLocker
            </span>
            Login via DigiLocker SSO
            <ExternalLink size={14} style={{ opacity: 0.8 }} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-card)' }} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>or email & password</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-card)' }} />
        </div>

        <form onSubmit={handleEmailAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Select Access Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid var(--border-card)',
                color: '#fff',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '0.88rem',
                fontWeight: 600,
                outline: 'none'
              }}
            >
              <option value="citizen">👤 Citizen (Public Parcel View)</option>
              <option value="officer">🛡️ Revenue Officer (Full Admin & Audit)</option>
              <option value="bank">🏦 Bank Auditor (Encumbrance Verification)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Email Address
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`officer@landsetu.gov.in`}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-card)',
                  color: '#fff',
                  padding: '10px 12px 10px 38px',
                  borderRadius: '8px',
                  fontSize: '0.88rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-card)',
                  color: '#fff',
                  padding: '10px 12px 10px 38px',
                  borderRadius: '8px',
                  fontSize: '0.88rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <button className="passport-btn" type="submit" disabled={loading} style={{ marginTop: '6px' }}>
            {loading ? 'Processing Firebase Auth...' : isSignUp ? 'Create Firebase Account' : 'Sign In with Firebase'} <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '18px', fontSize: '0.82rem' }}>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer' }}
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Register"}
          </button>

          <button
            type="button"
            onClick={onExploreDemo}
            style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontWeight: 600, cursor: 'pointer' }}
          >
            Skip to Map →
          </button>
        </div>
      </div>

      {showDigiLocker && (
        <DigiLockerModal
          onClose={() => setShowDigiLocker(false)}
          onProceedMock={() => {
            setShowDigiLocker(false);
            handleEmailAuthSubmit({ preventDefault: () => {} });
          }}
        />
      )}
    </div>
  );
}
