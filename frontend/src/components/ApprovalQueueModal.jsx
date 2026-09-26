import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import WorkflowRequestCard from './WorkflowRequestCard';
import { useAuthInfo } from '../authContext';
import { getPendingRequests, auditorPassRequest, approveBoundaryRequest, rejectBoundaryRequest, villageApproveDeletion, auditorApproveDeletion, villagePassRequest, fastApproveRequest, villageApproveArchival, auditorApproveArchival, withdrawRequest, raiseConcern, acknowledgeConcern, resolveConcern } from '../api';

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

  // One runner for the actions the API decides: run it, show the result, reload the queue.
  const run = async (fn, okMessage, ulpin) => {
    try {
      await fn();
      setActionMsg(okMessage);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed(ulpin);
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
      await fetchRequests();
    }
  };

  const cardHandlers = (req) => ({
    villagePass: () => run(() => villagePassRequest(req.id), `Request #${req.id} verified and forwarded to the auditor.`, req.ulpin),
    villageDelete: () => run(() => villageApproveArchival(req.id), `Archival #${req.id} approved and forwarded to the auditor.`, req.ulpin),
    auditorPass: () => run(() => auditorPassRequest(req.id, req), `Request #${req.id} passed audit and went to the state admin.`, req.ulpin),
    auditorDelete: () => run(() => auditorApproveArchival(req.id), `Parcel ${req.ulpin} archived. Its record and history stay on file.`, req.ulpin),
    approve: (record) => run(() => approveBoundaryRequest(req.id, req, record), `Request #${req.id} approved and applied.`, req.ulpin),
    fastApprove: () => run(() => fastApproveRequest(req.id), `Correction #${req.id} approved and applied.`, req.ulpin),
    reject: () => run(() => rejectBoundaryRequest(req.id, req), `Request #${req.id} rejected.`, req.ulpin),
    withdraw: () => run(() => withdrawRequest(req.id), `Request #${req.id} withdrawn.`, req.ulpin),
    raise: (reason) => run(() => raiseConcern(req.id, reason), 'Concern recorded. It is now with the reviewer who holds the request.', req.ulpin),
    acknowledge: (flagId) => run(() => acknowledgeConcern(flagId), 'Concern acknowledged. It still blocks approval until resolved.', req.ulpin),
    resolve: (flagId, note) => run(() => resolveConcern(flagId, note), 'Concern resolved.', req.ulpin),
  });

  const handleFastApprove = async (id, ulpin) => {
    try {
      await fastApproveRequest(id);
      setActionMsg(`Correction #${id} for ULPIN '${ulpin}' approved and applied.`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed(ulpin);
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
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
      setActionMsg(`Land deletion for ULPIN '${ulpin}' fully authorized! Parcel archived.`);
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

        <div className="note">
          Recorded in this browser while the records service was unreachable. It never entered the approval
          pipeline, so no one can approve or reject it here. File it again from the map once the service is back.
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
              req.permissions ? (
                <WorkflowRequestCard key={req.id} req={req} on={cardHandlers(req)} />
              ) : renderLegacy(req)
            ))
          )}
        </div>
      </div>
    </div>
  );
}
