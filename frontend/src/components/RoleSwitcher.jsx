import React from 'react';
const ROLES = [
  { id: 'citizen', label: '👤 Citizen (Read-Only)' },
];

export default function RoleSwitcher({ currentRole, onRoleChange }) {
  const activeRole = currentRole || 'citizen';

  const handleRoleSelect = (newRole) => {
    if (onRoleChange) onRoleChange(newRole);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
        Mode:
      </label>
      <select
        value={activeRole}
        onChange={(e) => handleRoleSelect(e.target.value)}
        style={{
          background: 'rgba(59, 130, 246, 0.12)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          color: '#60a5fa',
          padding: '6px 12px',
          borderRadius: '8px',
          fontSize: '0.82rem',
          fontWeight: 700,
          outline: 'none',
          cursor: 'pointer'
        }}
      >
        {ROLES.map((r) => (
          <option key={r.id} value={r.id} style={{ background: '#111827', color: '#fff' }}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}
