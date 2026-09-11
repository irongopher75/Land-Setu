import React, { useState, useEffect } from 'react';
import { UserCheck, Shield, Building2 } from 'lucide-react';
import { mockLogin } from '../api';

export default function RoleSwitcher({ onRoleChange }) {
  const [currentRole, setCurrentRole] = useState(
    localStorage.getItem('landsetu_role') || 'officer'
  );

  useEffect(() => {
    // Initial login on mount to ensure valid token
    handleRoleSelect(currentRole);
  }, []);

  const handleRoleSelect = async (role) => {
    try {
      await mockLogin(role);
      setCurrentRole(role);
      if (onRoleChange) {
        onRoleChange(role);
      }
    } catch (err) {
      console.error('Role login failed:', err);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
        Role:
      </label>
      <select
        value={currentRole}
        onChange={(e) => handleRoleSelect(e.target.value)}
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid var(--border-card)',
          color: '#fff',
          padding: '6px 12px',
          borderRadius: '8px',
          fontSize: '0.85rem',
          fontWeight: 600,
          outline: 'none',
          cursor: 'pointer'
        }}
      >
        <option value="citizen">👤 Citizen (Redacted View)</option>
        <option value="officer">🛡️ Revenue Officer (Full Access)</option>
        <option value="bank">🏦 Bank Auditor (Full Access)</option>
      </select>
    </div>
  );
}
