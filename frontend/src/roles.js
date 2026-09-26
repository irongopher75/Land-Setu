// One place for what each role is called and may do in the interface. Mirrors the API's role checks
// (backend/app/routes/*: require_roles), which are what actually enforce access; this only decides what to show,
// so no one is offered an action the API will refuse.
// super_admin is shown as state_admin everywhere except account management (App.jsx, effectiveRole).

export const KNOWN_ROLES = ['citizen', 'village_officer', 'officer', 'auditor', 'state_admin', 'bank', 'super_admin'];

export const ROLE_LABEL = {
  citizen: 'Citizen',
  village_officer: 'Village Land Officer',
  officer: 'Revenue Officer',
  auditor: 'Land Auditor',
  state_admin: 'State Admin Officer',
  bank: 'Lender (bank)',
  super_admin: 'Super Administrator',
};

const CAN = {
  fileBoundary: ['village_officer', 'officer', 'auditor', 'state_admin', 'super_admin'],       // POST /parcels/custom
  splitMerge: ['village_officer', 'officer', 'state_admin', 'super_admin'],                    // split/merge-request
  requestArchival: ['state_admin', 'super_admin'],                                            // request-deletion
  fileCorrection: ['citizen', 'village_officer', 'officer', 'auditor', 'state_admin', 'super_admin'],
  passport: ['officer', 'bank', 'auditor', 'state_admin', 'super_admin'],                      // /{ulpin}/passport
  reviewQueue: ['village_officer', 'officer', 'auditor', 'state_admin', 'super_admin'],        // /requests/pending
  officerConsole: ['village_officer', 'officer', 'auditor', 'state_admin', 'super_admin'],
  auditLog: ['auditor', 'state_admin', 'super_admin'],                                         // /parcels/audit-log
  lenderCheck: ['bank', 'state_admin', 'super_admin'],
};

export const can = (role, action) => (CAN[action] || []).includes(role);
