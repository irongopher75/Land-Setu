import React, { useState } from 'react';
import { X, ShieldCheck, CheckCircle2, ArrowRight, Lock, KeyRound, UserCheck, ShieldAlert } from 'lucide-react';

export default function DigiLockerModal({ onClose, onProceedMock }) {
  const [step, setStep] = useState('input'); // 'input' | 'otp' | 'verified'
  const [aadhaarNum, setAadhaarNum] = useState('8821 4402 9901');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifiedToken, setVerifiedToken] = useState(null);

  const handleSendOtp = (e) => {
    e.preventDefault();
    if (!aadhaarNum || aadhaarNum.replace(/\s/g, '').length < 12) {
      alert('Please enter a valid 12-digit Aadhaar Number or DigiLocker ID.');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep('otp');
    }, 800);
  };

  const handleVerifyOtp = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const cleanAadhaar = aadhaarNum.replace(/\s/g, '');
      const masked = `XXXX-XXXX-${cleanAadhaar.slice(-4)}`;
      setVerifiedToken({
        name: 'Ramesh Kumar (Citizen)',
        maskedAadhaar: masked,
        dob: '1988-06-15',
        gender: 'Male',
        issuer: 'UIDAI / MeitY DigiLocker Sandbox SSO',
        tokenId: `DIGI-${Date.now()}-${cleanAadhaar.slice(-4)}`
      });
      setStep('verified');
    }, 1000);
  };

  const handleCompleteSSO = () => {
    onProceedMock(verifiedToken);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '500px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: '#1e3a8a', padding: '8px 14px', borderRadius: '10px', fontWeight: 900, color: '#fff', fontSize: '0.95rem', letterSpacing: '0.5px', boxShadow: '0 0 15px rgba(30,58,138,0.5)' }}>
              DigiLocker
            </div>
            <div>
              <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '1.15rem', color: '#0f172a', margin: 0 }}>
                Aadhaar & DigiLocker SSO Gateway
              </h3>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>MeitY | National e-Governance Division (NeGD)</div>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Step 1: Input Aadhaar Number */}
        {step === 'input' && (
          <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '14px', borderRadius: '10px', fontSize: '0.82rem', color: '#0369a1', lineHeight: 1.4 }}>
              🔒 <strong>Sandbox Integration</strong>: Enter a 12-digit Aadhaar / DigiLocker ID to simulate real-time UIDAI e-KYC demographic identity verification.
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                12-Digit Aadhaar / DigiLocker ID
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  type="text"
                  value={aadhaarNum}
                  onChange={(e) => setAadhaarNum(e.target.value)}
                  placeholder="8821 4402 9901"
                  style={{
                    width: '100%',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    color: '#0f172a',
                    padding: '10px 12px 10px 38px',
                    borderRadius: '8px',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    letterSpacing: '1px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                className="passport-btn"
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', flex: 1 }}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="passport-btn"
                disabled={loading}
                style={{ flex: 1.5, background: 'linear-gradient(135deg, #1e3a8a, #0284c7)', color: '#fff' }}
              >
                {loading ? 'Connecting UIDAI Gateway...' : 'Send e-KYC OTP →'}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Enter OTP */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '14px', borderRadius: '10px', fontSize: '0.82rem', color: '#15803d', lineHeight: 1.4 }}>
              📱 <strong>OTP Sent!</strong> Enter the 6-digit OTP code sent to the UIDAI registered mobile associated with <strong>{aadhaarNum}</strong> (Demo Code: <code>123456</code>).
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                Enter 6-Digit OTP Code
              </label>
              <div style={{ position: 'relative' }}>
                <KeyRound size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                  style={{
                    width: '100%',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    color: '#0f172a',
                    padding: '10px 12px 10px 38px',
                    borderRadius: '8px',
                    fontSize: '1.1rem',
                    fontWeight: 800,
                    letterSpacing: '4px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                className="passport-btn"
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', flex: 1 }}
                onClick={() => setStep('input')}
              >
                ← Back
              </button>
              <button
                type="submit"
                className="passport-btn"
                disabled={loading}
                style={{ flex: 1.5, background: 'linear-gradient(135deg, #15803d, #047857)', color: '#fff' }}
              >
                {loading ? 'Verifying OTP...' : 'Authenticate Identity ✓'}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Verified Citizen Identity Issued */}
        {step === 'verified' && verifiedToken && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '16px', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#10b981', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px' }}>
                <UserCheck color="#fff" size={24} />
              </div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', color: '#065f46', fontWeight: 800 }}>
                Aadhaar e-KYC Identity Verified!
              </h4>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#047857' }}>
                Issued by {verifiedToken.issuer}
              </p>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Citizen Name:</span>
                <strong style={{ color: '#0f172a' }}>{verifiedToken.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Aadhaar Number:</span>
                <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{verifiedToken.maskedAadhaar}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Date of Birth:</span>
                <strong style={{ color: '#0f172a' }}>{verifiedToken.dob}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>DigiLocker Token:</span>
                <strong style={{ color: '#0284c7', fontSize: '0.75rem', fontFamily: 'monospace' }}>{verifiedToken.tokenId}</strong>
              </div>
            </div>

            <button
              onClick={handleCompleteSSO}
              className="passport-btn"
              style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #1d4ed8, #0284c7)', color: '#fff', fontSize: '0.9rem', fontWeight: 800 }}
            >
              Proceed to Citizen Portal with Verified Identity →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
