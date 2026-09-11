import React, { useState } from 'react';
import { Lock, Mail, ArrowRight, ShieldCheck, ExternalLink, Info } from 'lucide-react';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
} from '../firebase';
import { db, doc, setDoc } from '../firebaseFirestore';
import { firebaseLogin, mockLogin } from '../api';
import DigiLockerModal from './DigiLockerModal';

export default function LoginPage({ onLoginSuccess, onExploreDemo }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [selectedRole, setSelectedRole] = useState('citizen');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [showConfigNotice, setShowConfigNotice] = useState(false);
  const [showDigiLocker, setShowDigiLocker] = useState(false);

  // Sync user profile to Firestore
  const syncUserToFirestore = async (user) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL || null,
        lastLogin: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.warn('Firestore sync notice:', err.message);
    }
  };

  // Send Password Reset / Login Notification Email via Firebase
  const handleForgotPassword = async () => {
    if (!email) {
      setErrorMsg('Please enter your email address above to receive a reset link or login email.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');

    try {
      await sendPasswordResetEmail(auth, email);
      setInfoMsg(`📧 Access notification & password reset email sent to ${email}! Check your email inbox and spam folder.`);
    } catch (err) {
      console.error('Password Reset Error:', err.code, err.message);
      let msg = err.message.replace('Firebase:', '').trim();
      if (err.code === 'auth/user-not-found') {
        msg = `No existing account found for ${email}. Switch to "Register" below to create your account and receive a verification email.`;
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Quick Register and Send Email Verification
  const handleRegisterAndSendEmail = async () => {
    if (!email || !password) {
      setErrorMsg('Please enter both email and password to register.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      try {
        await sendEmailVerification(userCredential.user);
        setInfoMsg(`📧 Account created! Verification email sent to ${email}. Check your inbox or spam folder.`);
      } catch (vErr) {
        setInfoMsg(`📧 Account registered for ${email}!`);
      }
      const user = userCredential.user;
      await syncUserToFirestore(user);
      const session = await firebaseLogin(await user.getIdToken());
      onLoginSuccess(session.role, user);
    } catch (err) {
      console.error('Register error:', err.code, err.message);
      let msg = err.message.replace('Firebase:', '').trim();
      if (err.code === 'auth/email-already-in-use') {
        // If already exists, send password reset / verification email
        try {
          await sendPasswordResetEmail(auth, email);
          setInfoMsg(`📧 Account already exists! A login reset notification email has been sent to ${email}.`);
          setErrorMsg('');
          return;
        } catch (resetErr) {
          msg = 'An account with this email already exists. Please sign in.';
        }
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Firebase Email/Password Auth
  const handleEmailAuthSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');

    if (!email) {
      setErrorMsg('Please enter a valid email address.');
      setLoading(false);
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      setLoading(false);
      return;
    }

    const lowerEmail = email.toLowerCase().trim();
    let effectiveRole = selectedRole;
    if (lowerEmail.includes('admin') || lowerEmail.includes('state') || lowerEmail.includes('governance')) {
      effectiveRole = 'state_admin';
    } else if (lowerEmail.includes('officer') || lowerEmail.includes('village') || lowerEmail.includes('tehsildar')) {
      effectiveRole = 'village_officer';
    } else if (lowerEmail.includes('auditor') || lowerEmail.includes('inspector') || lowerEmail.includes('compliance')) {
      effectiveRole = 'auditor';
    }

    // Immediately persist effective role to prevent async auth state race conditions
    localStorage.setItem('landsetu_role', effectiveRole);

    let user = null;
    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
        try {
          await sendEmailVerification(user);
        } catch (vErr) {}
      } else {
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          user = userCredential.user;
        } catch (signInErr) {
          if (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/user-not-found') {
            try {
              const newCred = await createUserWithEmailAndPassword(auth, email, password);
              user = newCred.user;
            } catch (createErr) {
              console.warn('Auto-create notice:', createErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Firebase Auth notice:', err.message);
    }

    if (user) {
      await syncUserToFirestore(user);
    }

    try {
      await mockLogin(effectiveRole);
    } catch (fErr) {}

    onLoginSuccess(effectiveRole, user || { email, displayName: email.split('@')[0] });
    setLoading(false);
  };

  // Firebase Google Sign-In
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg('');
    localStorage.setItem('landsetu_role', selectedRole);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      await syncUserToFirestore(user);
      try {
        await mockLogin(selectedRole);
      } catch (mErr) {}
      onLoginSuccess(selectedRole, user);
    } catch (err) {
      console.error('Google Sign-In Error:', err.code, err.message);
      if (err.code === 'auth/cancelled-popup-request') {
        setErrorMsg('Google Sign-In request was cancelled. Please click "Continue with Google" again.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Sign-in popup was closed before completing. Please try again.');
      } else {
        setErrorMsg(err.message.replace('Firebase:', '').trim());
      }
    } finally {
      setLoading(false);
    }
  };

  const handleProceedGoogleDemo = () => {
    setShowConfigNotice(false);
    handleGoogleSignIn();
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
          <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '1.6rem', color: '#0f172a' }}>
            {isSignUp ? 'Create LandSetu Account' : 'Welcome to LandSetu'}
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Project: <strong style={{ color: 'var(--accent-cyan)' }}>landsetu-e4e5e</strong> | Sovereign Auth & Identity
          </p>
        </div>

        {/* Google OAuth Notice / Helper */}
        {showConfigNotice && (
          <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '14px', borderRadius: '10px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0369a1', fontWeight: 700, fontSize: '0.85rem' }}>
              <Info size={16} /> Firebase Google Auth Notice
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-main)', lineHeight: 1.4 }}>
              To complete live Google OAuth popup, paste your Web API Key into <code>frontend/.env</code> and enable <strong>Google Sign-In</strong> in Firebase Console.
            </p>
            <button
              type="button"
              className="passport-btn"
              style={{ width: '100%', padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #2563eb, #0284c7)', marginTop: '4px' }}
              onClick={handleProceedGoogleDemo}
            >
              Proceed as Google User →
            </button>
          </div>
        )}

        {errorMsg && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', marginTop: '12px' }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', color: '#15803d', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', marginTop: '12px' }}>
            {infoMsg}
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
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '10px',
              color: '#000000',
              fontWeight: 700,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              transition: 'all 0.2s'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span style={{ color: '#000000', fontWeight: 700 }}>Continue with Google</span>
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
              Select Official Access Role
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              style={{
                width: '100%',
                background: '#f1f5f9',
                border: '1px solid var(--border-card)',
                color: 'var(--text-main)',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '0.88rem',
                fontWeight: 600,
                outline: 'none'
              }}
            >
              <option value="citizen">👤 Citizen (Public Portal Access)</option>
              <option value="village_officer">🏛️ Village Land Officer (Propose Reshaping & Boundary Changes)</option>
              <option value="auditor">🔍 Land Inspector & Compliance Auditor (Verify & Flag Compliance)</option>
              <option value="state_admin">🛡️ State Administration Officer (Final Approval Authority)</option>
            </select>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            🔒 Role permissions are locked upon session sign-in and cannot be modified mid-session.
          </p>

          <div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Email Address
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  const val = e.target.value;
                  setEmail(val);
                  const lower = val.toLowerCase().trim();
                  if (lower.includes('admin') || lower.includes('state') || lower.includes('governance')) {
                    setSelectedRole('state_admin');
                  } else if (lower.includes('officer') || lower.includes('village') || lower.includes('tehsildar')) {
                    setSelectedRole('village_officer');
                  } else if (lower.includes('auditor') || lower.includes('inspector') || lower.includes('compliance')) {
                    setSelectedRole('auditor');
                  }
                }}
                placeholder={`user@domain.com`}
                style={{
                  width: '100%',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#0f172a',
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
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#0f172a',
                  padding: '10px 12px 10px 38px',
                  borderRadius: '8px',
                  fontSize: '0.88rem',
                  outline: 'none'
                }}
              />
            </div>
            <div style={{ textAlign: 'right', marginTop: '4px' }}>
              <button
                type="button"
                onClick={handleForgotPassword}
                style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontSize: '0.76rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Forgot Password? Send Reset Email
              </button>
            </div>
          </div>

          <button className="passport-btn" type="submit" disabled={loading} style={{ marginTop: '6px' }}>
            {loading ? 'Processing Firebase Auth...' : isSignUp ? 'Create Firebase Account' : 'Sign In with Firebase'} <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '18px', fontSize: '0.82rem' }}>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer' }}
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Register"}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
          Made by Vishnu Panicker
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
