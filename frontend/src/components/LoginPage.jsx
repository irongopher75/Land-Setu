import React, { useState } from 'react';
import { Lock, Mail, Shield, User, ArrowRight, ShieldCheck, ExternalLink } from 'lucide-react';
import { mockLogin } from '../api';
import DigiLockerModal from './DigiLockerModal';

export default function LoginPage({ onLoginSuccess, onExploreDemo }) {
  const [role, setRole] = useState('citizen');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDigiLocker, setShowDigiLocker] = useState(false);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await mockLogin(role);
      onLoginSuccess(role);
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', position: 'relative', overflow: 'hidden' }}>
      {/* Background glow effects */}
      <div style={{ position: 'absolute', top: '20%', left: '30%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(0,0,0,0) 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '20%', right: '30%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(6,182,212,0.15) 0%, rgba(0,0,0,0) 70%)', pointerEvents: 'none' }} />

      <div className="modal-card" style={{ maxWidth: '440px', width: '100%', padding: '32px', position: 'relative', zIndex: 10 }}>
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(59,130,246,0.4)', marginBottom: '12px' }}>
            <ShieldCheck color="#fff" size={26} />
          </div>
          <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '1.6rem', color: '#fff' }}>
            Welcome to LandSetu
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Sign in to access unified parcel records & spatial analytics
          </p>
        </div>

        {/* DigiLocker Button */}
        <button
          type="button"
          onClick={() => setShowDigiLocker(true)}
          style={{
            width: '100%',
            padding: '12px',
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
            gap: '10px',
            boxShadow: '0 4px 12px rgba(30, 58, 138, 0.4)',
            transition: 'all 0.2s',
            margin: '16px 0 20px 0'
          }}
        >
          <span style={{ background: '#fff', color: '#1e3a8a', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
            DigiLocker
          </span>
          Login with DigiLocker SSO
          <ExternalLink size={14} style={{ opacity: 0.8 }} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 20px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-card)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>or sign in with role</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-card)' }} />
        </div>

        <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
              Email or ULPIN Identifier
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={role === 'citizen' ? 'citizen@example.com' : 'TN-CHN-0042-1187'}
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
              Security Password
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

          <button className="passport-btn" type="submit" disabled={loading} style={{ marginTop: '8px' }}>
            {loading ? 'Authenticating...' : 'Sign In to Platform'} <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onExploreDemo}
            style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
          >
            Explore GIS Map Dashboard without logging in →
          </button>
        </div>
      </div>

      {showDigiLocker && (
        <DigiLockerModal
          onClose={() => setShowDigiLocker(false)}
          onProceedMock={() => {
            setShowDigiLocker(false);
            onLoginSuccess('citizen');
          }}
        />
      )}
    </div>
  );
}
