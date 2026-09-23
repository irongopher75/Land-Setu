import React from 'react';
const ROLES = [
  { id: 'citizen', label: 'Citizen (read only)' },
];

export default function RoleSwitcher({ currentRole, onRoleChange }) {
  const activeRole = currentRole || 'citizen';

  const handleRoleSelect = (newRole) => {
    if (onRoleChange) onRoleChange(newRole);
  };

  return (
    <label className="row subtle">
      Mode
      <select className="input" value={activeRole} onChange={(e) => handleRoleSelect(e.target.value)}>
        {ROLES.map((r) => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>
    </label>
  );
}
