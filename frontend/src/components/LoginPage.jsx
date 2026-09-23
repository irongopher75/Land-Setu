import React, { useState } from 'react';
import { Lock, Mail, ArrowRight } from 'lucide-react';
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
import { firebaseLogin } from '../api';
import DigiLockerModal from './DigiLockerModal';


// Plain-language auth errors. Never show vendor names or raw error codes to the public.
const authMessage = (err) => {
  switch (err && err.code) {
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Email or password is incorrect.';
    case 'auth/user-not-found': return 'No account found for this email.';
    case 'auth/email-already-in-use': return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password': return 'Choose a password of at least 6 characters.';
    case 'auth/too-many-requests': return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed': return 'No network connection. Check your connection and try again.';
    case 'auth/cancelled-popup-request': return 'Sign-in was cancelled. Try again.';
    case 'auth/popup-closed-by-user': return 'The sign-in window was closed before it finished. Try again.';
    default: return 'Sign-in did not work. Try again in a moment.';
  }
};

export default function LoginPage({ onLoginSuccess, onExploreDemo }) {
  const [audience, setAudience] = useState('citizen'); // 'citizen' | 'officer'
  const [isSignUp, setIsSignUp] = useState(false);
  const [selectedRole, setSelectedRole] = useState('citizen');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
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
      setErrorMsg('Enter your email address first, then ask for a reset link.');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');

    try {
      await sendPasswordResetEmail(auth, email);
      setInfoMsg(`A password reset email was sent to ${email}. Check your inbox and spam folder.`);
    } catch (err) {
      console.error('Password Reset Error:', err.code, err.message);
      let msg = authMessage(err);
      if (err.code === 'auth/user-not-found') {
        msg = 'No account found for this email.';
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
        setInfoMsg(`Account created! Verification email sent to ${email}. Check your inbox or spam folder.`);
      } catch (vErr) {
        setInfoMsg(`Account registered for ${email}!`);
      }
      const user = userCredential.user;
      await syncUserToFirestore(user);
      const session = await firebaseLogin(await user.getIdToken());
      onLoginSuccess(session.role, user);
    } catch (err) {
      console.error('Register error:', err.code, err.message);
      let msg = authMessage(err);
      if (err.code === 'auth/email-already-in-use') {
        // If already exists, send password reset / verification email
        try {
          await sendPasswordResetEmail(auth, email);
          setInfoMsg(`Account already exists! A login reset notification email has been sent to ${email}.`);
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

  // Firebase Email/Password Auth with Server-Verified Custom Claims
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
          if (audience === 'citizen' && signInErr.code === 'auth/user-not-found') {
            try {
              const newCred = await createUserWithEmailAndPassword(auth, email, password);
              user = newCred.user;
            } catch (createErr) {
              console.warn('Auto-create notice:', createErr.message);
            }
          } else {
            throw signInErr;
          }
        }
      }
    } catch (err) {
      console.warn('Firebase Auth error:', err.message);
      setErrorMsg(authMessage(err));
      setLoading(false);
      return;
    }

    if (!user) {
      setErrorMsg('Email or password is incorrect.');
      setLoading(false);
      return;
    }
    await syncUserToFirestore(user);

    let verifiedRole = 'citizen';
    try {
      if (user) {
        const idToken = await user.getIdToken();
        const session = await firebaseLogin(idToken);
        if (session && session.role) {
          verifiedRole = session.role;
        }
      }
    } catch (fErr) {
      console.warn('Firebase server token verification notice:', fErr.message);
    }

    localStorage.setItem('landsetu_role', verifiedRole);
    onLoginSuccess(verifiedRole, user || { email, displayName: email.split('@')[0] });
    setLoading(false);
  };

  // Firebase Google Sign-In with Server-Verified Custom Claims
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      await syncUserToFirestore(user);

      let verifiedRole = 'citizen';
      try {
        const idToken = await user.getIdToken();
        const session = await firebaseLogin(idToken);
        if (session && session.role) {
          verifiedRole = session.role;
        }
      } catch (mErr) {
        console.warn('Google sign-in token verification notice:', mErr.message);
      }

      localStorage.setItem('landsetu_role', verifiedRole);
      onLoginSuccess(verifiedRole, user);
    } catch (err) {
      console.error('Google Sign-In Error:', err.code, err.message);
      if (err.code === 'auth/cancelled-popup-request') {
        setErrorMsg('Sign-in was cancelled. Try again.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Sign-in popup was closed before completing. Please try again.');
      } else {
        setErrorMsg(authMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const isOfficer = audience === 'officer';

  return (
    <div className="auth-page">
      <div className="modal-card auth-card">
        <div className="modal-head">
          <div>
            <h2>Sign in</h2>
            <p>LandSetu land records portal</p>
          </div>
        </div>

        <div className="audience-tabs" role="tablist" aria-label="Who is signing in">
          <button role="tab" aria-selected={!isOfficer} className={!isOfficer ? 'is-active' : ''} onClick={() => { setAudience('citizen'); setErrorMsg(''); setInfoMsg(''); }}>
            Citizen
            <small>Search records, request a correction</small>
          </button>
          <button role="tab" aria-selected={isOfficer} className={isOfficer ? 'is-active' : ''} onClick={() => { setAudience('officer'); setIsSignUp(false); setErrorMsg(''); setInfoMsg(''); }}>
            Land officer
            <small>Village officer, auditor, state admin</small>
          </button>
        </div>

        {isOfficer ? (
          <div className="callout">Officer accounts are issued by your state land records office. Your role comes from that account. You cannot choose or change it here.</div>
        ) : (
          <div className="stack">
            <button type="button" className="btn btn--primary btn--block" onClick={() => setShowDigiLocker(true)}>Continue with DigiLocker</button>
            <button type="button" className="btn btn--block" onClick={handleGoogleSignIn}>Continue with Google</button>
            <div className="rule-label"><span>Or continue with email</span></div>
          </div>
        )}

        {errorMsg && <div className="callout callout--alert" role="alert">{errorMsg}</div>}
        {infoMsg && <div className="callout callout--verified" role="status">{infoMsg}</div>}

        <form onSubmit={handleEmailAuthSubmit} className="stack">
          <label className="field">
            {isOfficer ? 'Official email address' : 'Email address'}
            <span className="input-icon">
              <Mail size={16} aria-hidden="true" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={isOfficer ? 'name@office.example' : 'name@example.com'} autoComplete="email" />
            </span>
          </label>

          <label className="field">
            Password
            <span className="input-icon">
              <Lock size={16} aria-hidden="true" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignUp ? 'new-password' : 'current-password'} />
            </span>
          </label>
          <button type="button" className="link-btn" onClick={handleForgotPassword}>Forgot password? Send a reset email</button>

          <button className="btn btn--primary btn--block" type="submit" disabled={loading}>
            {loading ? 'Please wait' : isSignUp ? 'Create account' : 'Sign in'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>

        {!isOfficer && (
          <button type="button" className="link-btn link-btn--center" onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? 'Already have an account? Sign in' : 'New here? Create a citizen account'}
          </button>
        )}
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
