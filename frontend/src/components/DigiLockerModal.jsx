import React, { useState } from 'react';
import { X, Lock, KeyRound, UserCheck } from 'lucide-react';

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
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="row">
            <span className="wordmark-tile">DigiLocker</span>
            <div>
              <h3>Aadhaar and DigiLocker sign-in</h3>
              <p>Sandbox. No real UIDAI call is made.</p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {step === 'input' && (
          <form onSubmit={handleSendOtp} className="stack">
            <div className="callout">Enter a 12-digit Aadhaar or DigiLocker ID. The demo accepts any 12 digits.</div>
            <label className="field">
              12-digit Aadhaar or DigiLocker ID
              <span className="input-icon">
                <Lock size={16} aria-hidden="true" />
                <input className="input--spaced" type="text" value={aadhaarNum} onChange={(e) => setAadhaarNum(e.target.value)} placeholder="8821 4402 9901" />
              </span>
            </label>
            <div className="btn-row">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={loading}>{loading ? 'Connecting' : 'Send OTP'}</button>
            </div>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="stack">
            <div className="callout">OTP sent to the mobile linked to <strong className="data-id">{aadhaarNum}</strong>. Demo code: <code className="data-id">123456</code>.</div>
            <label className="field">
              6-digit OTP
              <span className="input-icon">
                <KeyRound size={16} aria-hidden="true" />
                <input className="input--spaced" type="text" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" />
              </span>
            </label>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => setStep('input')}>Back</button>
              <button type="submit" className="btn btn--primary" disabled={loading}>{loading ? 'Verifying' : 'Verify identity'}</button>
            </div>
          </form>
        )}

        {step === 'verified' && verifiedToken && (
          <div className="stack">
            <div className="callout callout--verified">
              <div className="title-row"><UserCheck size={18} aria-hidden="true" /><strong>Identity verified</strong></div>
              <div className="subtle">Issued by {verifiedToken.issuer}</div>
            </div>
            <div>
              <div className="stat-line"><span>Citizen name</span><strong>{verifiedToken.name}</strong></div>
              <div className="stat-line"><span>Aadhaar</span><strong className="data-id">{verifiedToken.maskedAadhaar}</strong></div>
              <div className="stat-line"><span>Date of birth</span><strong className="tabular">{verifiedToken.dob}</strong></div>
              <div className="stat-line"><span>Token</span><strong className="data-id">{verifiedToken.tokenId}</strong></div>
            </div>
            <button onClick={handleCompleteSSO} className="btn btn--primary btn--block">Continue to the citizen portal</button>
          </div>
        )}
      </div>
    </div>
  );
}
