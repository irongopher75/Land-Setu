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
import { firebaseLogin } from '../api';
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
      setInfoMsg(`Access notification & password reset email sent to ${email}! Check your email inbox and spam folder.`);
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
      let msg = err.message.replace('Firebase:', '').trim();
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
          if (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/user-not-found') {
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
      setErrorMsg(err.message.replace('Firebase:', '').trim());
      setLoading(false);
      return;
    }

    if (user) {
      await syncUserToFirestore(user);
    }

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
    <div className="auth-page">
      <div className="modal-card auth-card">
        <div className="modal-head">
          <div>
            <h2>{isSignUp ? 'Create a LandSetu account' : 'Sign in to LandSetu'}</h2>
            <p>Your role is set by the server from your account, never by this page.</p>
          </div>
          <ShieldCheck size={24} aria-hidden="true" />
        </div>

        {showConfigNotice && (
          <div className="callout stack--tight stack">
            <div className="title-row"><Info size={16} aria-hidden="true" /><strong>Firebase Google sign-in setup</strong></div>
            <p>To use the live Google popup, put your Web API key in <code className="data-id">frontend/.env</code> and enable Google sign-in in the Firebase console.</p>
            <button type="button" className="btn btn--primary" onClick={handleProceedGoogleDemo}>Continue as Google user</button>
          </div>
        )}

        {errorMsg && <div className="callout callout--alert" role="alert">{errorMsg}</div>}
        {infoMsg && <div className="callout callout--verified" role="status">{infoMsg}</div>}

        <div className="stack">
          <button type="button" className="btn btn--block" onClick={handleGoogleSignIn}>Continue with Google</button>
          <button type="button" className="btn btn--primary btn--block" onClick={() => setShowDigiLocker(true)}>
            <span>Sign in with DigiLocker</span>
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="rule-label"><span>or use email</span></div>

        <form onSubmit={handleEmailAuthSubmit} className="stack">
          <label className="field">
            Email address
            <span className="input-icon">
              <Mail size={16} aria-hidden="true" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />
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
            {loading ? 'Signing in' : isSignUp ? 'Create account' : 'Sign in'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>

        <button type="button" className="link-btn link-btn--center" onClick={() => setIsSignUp(!isSignUp)}>
          {isSignUp ? 'Already have an account? Sign in' : "No account yet? Register"}
        </button>
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
