import React, { useCallback, useEffect, useState } from 'react';
import OfficerFrame from './OfficerFrame';
import { useAuthInfo } from '../../authContext';
import { listAccounts, createAccount, setAccountRole, setAccountDisabled, listRoleAudit } from '../../api';

const ROLES = [
  ['citizen', 'Citizen'],
  ['village_officer', 'Village land officer'],
  ['auditor', 'Auditor'],
  ['state_admin', 'State administrator'],
  ['bank', 'Bank (read only)'],
  ['super_admin', 'Super administrator'],
];
const LABEL = Object.fromEntries(ROLES);

export default function UsersPage({ role, isLoggedIn }) {
  const [users, setUsers] = useState(null);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [draft, setDraft] = useState({});     // uid -> chosen role, before saving
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'village_officer' });
  const [created, setCreated] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, a] = await Promise.all([listAccounts(), listRoleAudit()]);
      setUsers(u);
      setAudit(a);
    } catch (e) {
      setError(e.message);
      setUsers([]);
    }
  }, []);

  // Only a super administrator may list accounts; for anyone else the frame shows the permission notice.
  const { isSuper } = useAuthInfo();
  useEffect(() => { if (isLoggedIn && isSuper) load(); }, [isLoggedIn, isSuper, load]);

  const save = async (u) => {
    const next = draft[u.uid];
    if (!next || next === u.role) return;
    if (!window.confirm(`Change ${u.email} from ${LABEL[u.role]} to ${LABEL[next]}? They must sign in again to use the new role.`)) return;
    setBusy(u.uid); setError(null); setNote(null);
    try {
      await setAccountRole(u.uid, next);
      setNote(`${u.email} is now ${LABEL[next]}. They must sign in again.`);
      setDraft((d) => { const { [u.uid]: _, ...rest } = d; return rest; });
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const toggle = async (u) => {
    if (!window.confirm(`${u.disabled ? 'Enable' : 'Disable'} ${u.email}?`)) return;
    setBusy(u.uid); setError(null); setNote(null);
    try { await setAccountDisabled(u.uid, !u.disabled); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const create = async (e) => {
    e.preventDefault();
    setBusy('create'); setError(null); setNote(null); setCreated(null);
    try {
      const res = await createAccount(form.email.trim(), form.name.trim(), form.role);
      setCreated(res);
      setForm({ email: '', name: '', role: form.role });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  };

  return (
    <OfficerFrame title="Users and roles" path="/officer/users" role={role} isLoggedIn={isLoggedIn} superOnly wide>
      <p>Only super administrators see this page. A role is stored on the account and read by the server when the account signs in. Changing it signs the account out everywhere. Every change is recorded below.</p>

      {error && <div className="callout callout--alert" role="alert">{error}</div>}
      {note && <div className="callout callout--verified" role="status">{note}</div>}

      <section>
        <h2>Add an account</h2>
        <form className="stack" onSubmit={create}>
          <div className="field-row">
            <label className="field">Email address
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </label>
            <label className="field">Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
            </label>
          </div>
          <label className="field">Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button className="btn btn--primary btn--auto" disabled={busy === 'create'}>{busy === 'create' ? 'Creating' : 'Create account'}</button>
        </form>
        {created && (
          <div className="callout callout--verified" role="status">
            <strong>{created.email}</strong> created as {LABEL[created.role]}.
            <div>Temporary password: <span className="data-id">{created.temporary_password}</span></div>
            <div className="subtle">Shown once. Pass it to the person securely and ask them to change it. It is not stored.</div>
          </div>
        )}
      </section>

      <section>
        <h2>Accounts</h2>
        {users === null ? <p className="subtle">Loading.</p> : users.length === 0 ? <p className="subtle">No accounts to show.</p> : (
          <table className="data-table">
            <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const chosen = draft[u.uid] ?? u.role;
                return (
                  <tr key={u.uid}>
                    <td>{u.email}{u.display_name && <div className="subtle">{u.display_name}</div>}</td>
                    <td>
                      <select className="input" aria-label={`Role for ${u.email}`} value={chosen} onChange={(e) => setDraft({ ...draft, [u.uid]: e.target.value })}>
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td>{u.disabled ? <span className="badge stale">Disabled</span> : <span className="badge verified">Active</span>}</td>
                    <td className="tabular">{u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString('en-IN') : 'Never'}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn btn--primary" disabled={busy === u.uid || chosen === u.role} onClick={() => save(u)}>Save role</button>
                        <button className="btn btn--seal" disabled={busy === u.uid} onClick={() => toggle(u)}>{u.disabled ? 'Enable' : 'Disable'}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="subtle">You cannot change your own role or disable your own account, and the last super administrator cannot be removed.</p>
      </section>

      <section>
        <h2>Recent changes</h2>
        {audit.length === 0 ? <p className="subtle">No changes recorded yet.</p> : (
          <table className="data-table">
            <thead><tr><th scope="col">When</th><th scope="col">By</th><th scope="col">Account</th><th scope="col">Change</th></tr></thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td className="tabular">{new Date(a.at).toLocaleString('en-IN')}</td>
                  <td>{a.actor}</td>
                  <td>{a.target}</td>
                  <td>{a.action === 'set_role' ? `${LABEL[a.old_role] || a.old_role} to ${LABEL[a.new_role] || a.new_role}` : a.action === 'create' ? `Created as ${LABEL[a.new_role] || a.new_role}` : a.action === 'disable' ? 'Disabled' : 'Enabled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </OfficerFrame>
  );
}
