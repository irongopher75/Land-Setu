import React from 'react';
import PageShell from '../../components/PageShell';
import { useAuthInfo } from '../../authContext';

const OFFICER_ROLES = ['village_officer', 'officer', 'auditor', 'state_admin'];

const NAV = [
  { path: '/officer', label: 'Dashboard' },
  { path: '/officer/queue', label: 'Approval queue' },
  { path: '/officer/editor', label: 'Parcel editor' },
  { path: '/officer/audit', label: 'Audit log', roles: ['auditor', 'state_admin'] },
  { path: '/officer/import', label: 'Data import', roles: ['state_admin'] },
  { path: '/officer/analytics', label: 'Analytics', roles: ['state_admin'] },
  { path: '/officer/users', label: 'Users and roles', superOnly: true },
];

// Common frame for officer pages: access check, section navigation, page title.
export default function OfficerFrame({ title, path, role, isLoggedIn, allow = OFFICER_ROLES, superOnly = false, wide = false, children }) {
  const { isSuper } = useAuthInfo();
  const permitted = isLoggedIn && (superOnly ? isSuper : allow.includes(role));
  return (
    <PageShell title={title}>
      {isLoggedIn && OFFICER_ROLES.includes(role) && (
        <nav className="officer-nav" aria-label="Officer console">
          <ul>
            {NAV.filter((n) => (n.superOnly ? isSuper : !n.roles || n.roles.includes(role))).map((n) => (
              <li key={n.path}><a href={`#${n.path}`} className={n.path === path ? 'active' : ''} aria-current={n.path === path ? 'page' : undefined}>{n.label}</a></li>
            ))}
          </ul>
        </nav>
      )}
      {permitted ? (
        <div className={wide ? 'embed embed--wide' : 'embed'}>{children}</div>
      ) : (
        <div className="callout callout--alert" role="alert">
          {!isLoggedIn
            ? <>This page is for land officers. <a href="#/login">Sign in with an officer account</a> to continue.</>
            : <>Your account role does not include this page. Roles are assigned by the state land records office.</>}
        </div>
      )}
    </PageShell>
  );
}

export { OFFICER_ROLES };
