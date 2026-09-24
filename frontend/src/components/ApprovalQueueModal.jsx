import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import WorkflowRequestCard from './WorkflowRequestCard';
import { useAuthInfo } from '../authContext';
import { getPendingRequests, auditorPassRequest, approveBoundaryRequest, rejectBoundaryRequest, villageApproveDeletion, auditorApproveDeletion, villagePassRequest, REST_ONLY_REQUEST_TYPES } from '../api';

export default function ApprovalQueueModal({ onClose, onRequestProcessed, role }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');
  const { isSuper } = useAuthInfo();

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const data = await getPendingRequests();
      setRequests(data);
    } catch (err) {
      console.error('Failed to fetch pending requests:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAuditorPass = async (id, ulpin, req) => {
    try {
      await auditorPassRequest(id, req);
      setActionMsg(`Request #${id} for ULPIN '${ulpin}' passed auditor review & forwarded to State Admin!`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed(ulpin);
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  const handleApprove = async (id, ulpin, req) => {
    try {
      const res = await approveBoundaryRequest(id, req);
      setActionMsg(`Request #${id} for ULPIN '${ulpin}' approved and committed to master GIS database!`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed(ulpin);
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  const handleVillageApproveDeletion = async (id, ulpin) => {
    try {
      await villageApproveDeletion(id);
      setActionMsg(`Deletion request #${id} for ULPIN '${ulpin}' approved at Village level! Forwarded to Compliance Auditor.`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed();
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  const handleAuditorApproveDeletion = async (id, ulpin) => {
    try {
      await auditorApproveDeletion(id);
      setActionMsg(`Land deletion for ULPIN '${ulpin}' fully authorized! Parcel permanently removed from database.`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed();
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  const handleVillagePass = async (id, ulpin) => {
    try {
      await villagePassRequest(id);
      setActionMsg(`Request #${id} for ULPIN '${ulpin}' verified and forwarded to the auditor.`);
      await fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReject = async (id, ulpin, req) => {
    try {
      await rejectBoundaryRequest(id, req);
      setActionMsg(`Request #${id} for ULPIN '${ulpin}' rejected.`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed();
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  const ROLE_TITLE = { state_admin: 'State Admin Officer', auditor: 'Land Inspector and Compliance Auditor', village_officer: 'Village Land Officer' };

  const renderLegacy = (req) => {
    const isDeletion = req.status === 'PENDING_DELETION_VILLAGE' || req.status === 'PENDING_DELETION_AUDITOR' || req.type === 'DELETION';
    const isStage1 = req.status === 'PENDING_AUDITOR_REVIEW' || req.status === 'PENDING' || req.status === 'PENDING_DELETION_VILLAGE';
    const stages = isDeletion
      ? [
        { label: 'State admin filed', state: 'done' },
        { label: 'Village officer', state: req.status === 'PENDING_DELETION_VILLAGE' ? 'active' : 'done' },
        { label: 'Auditor', state: req.status === 'PENDING_DELETION_AUDITOR' ? 'active' : 'waiting' },
      ]
      : [
        { label: 'Village request', state: 'done' },
        { label: 'Audit review', state: isStage1 ? 'active' : 'done' },
        { label: 'State admin', state: isStage1 ? 'waiting' : 'active' },
      ];
    const canWithdraw = isDeletion
      ? (req.status === 'PENDING_DELETION_VILLAGE' && (role === 'village_officer' || role === 'state_admin')) || (req.status === 'PENDING_DELETION_AUDITOR' && (role === 'auditor' || role === 'state_admin'))
      : true;

    return (
      <article className="wf-request" key={req.id}>
        <header>
          <div>
            <span className="wf-request-type">{isDeletion ? 'Parcel deletion' : 'Boundary reshape'}</span>
            <span className="data-id">{req.ulpin}</span>
          </div>
          <span className="wf-request-id tabular">Request #{req.id}</span>
        </header>

        <ol className="wf-stages" aria-label="Approval stages">
          {stages.map((st) => (
            <li key={st.label} className={`is-${st.state}`}>
              {st.label}
              <small>{st.state === 'done' ? 'passed' : st.state === 'active' ? 'current' : 'waiting'}</small>
            </li>
          ))}
        </ol>

        <p className="wf-request-meta">Filed by {req.requested_by} ({req.requester_role}). {req.reason || 'No reason given.'}</p>
        {isDeletion && role === 'state_admin' && (
          <div className="note">You filed this deletion. The village officer and the auditor must each approve it. You cannot approve it yourself.</div>
        )}

        <div className="wf-actions">
          {isDeletion && req.status === 'PENDING_DELETION_VILLAGE' && (role === 'village_officer' || isSuper) && (
            <button className="btn btn--primary" onClick={() => handleVillageApproveDeletion(req.id, req.ulpin)}>Approve deletion</button>
          )}
          {isDeletion && req.status === 'PENDING_DELETION_AUDITOR' && (role === 'auditor' || isSuper) && (
            <button className="btn btn--seal-solid" onClick={() => handleAuditorApproveDeletion(req.id, req.ulpin)}>Authorize deletion</button>
          )}
          {!isDeletion && (role === 'auditor' || isSuper) && isStage1 && (
            <button className="btn btn--primary" onClick={() => handleAuditorPass(req.id, req.ulpin)}>Pass audit and forward to state admin</button>
          )}
          {!isDeletion && role === 'state_admin' && (
            <button className="btn btn--primary" onClick={() => handleApprove(req.id, req.ulpin)}>Approve and commit boundary</button>
          )}
          {canWithdraw && (
            <button className="btn btn--seal" onClick={() => handleReject(req.id, req.ulpin)}>{role === 'state_admin' && isDeletion ? 'Withdraw' : 'Reject'}</button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card modal-card--wide" role="dialog" aria-modal="true" aria-label="Governance queue">
        <div className="modal-head">
          <div>
            <h3>Governance queue</h3>
            <p>Signed in as {ROLE_TITLE[role] || 'reviewer'}. Every change passes the village officer, the auditor and the state admin.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {actionMsg && <div className="note note--ok" role="status">{actionMsg}</div>}

        <div className="queue-list">
          {loading ? (
            <div className="note">Loading requests</div>
          ) : requests.length === 0 ? (
            <div className="note">No open requests. Every boundary change, split, merge, correction and deletion has been processed.</div>
          ) : (
            requests.map((req) => (
              REST_ONLY_REQUEST_TYPES.includes(req.type) ? (
                <WorkflowRequestCard
                  key={req.id}
                  req={req}
                  role={role}
                  onVillagePass={() => handleVillagePass(req.id, req.ulpin)}
                  onAuditorPass={() => handleAuditorPass(req.id, req.ulpin, req)}
                  onApprove={() => handleApprove(req.id, req.ulpin, req)}
                  onReject={() => handleReject(req.id, req.ulpin, req)}
                />
              ) : renderLegacy(req)
            ))
          )}
        </div>
      </div>
    </div>
  );
}
