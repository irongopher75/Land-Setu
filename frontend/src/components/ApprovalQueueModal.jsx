import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import WorkflowRequestCard from './WorkflowRequestCard';
import { useAuthInfo } from '../authContext';
import { getPendingRequests, auditorPassRequest, approveBoundaryRequest, rejectBoundaryRequest, villagePassRequest, fastApproveRequest, villageApproveArchival, auditorApproveArchival, withdrawRequest, raiseConcern, acknowledgeConcern, resolveConcern } from '../api';

export default function ApprovalQueueModal({ onClose, onRequestProcessed, role }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');
  const [limit, setLimit] = useState(50);
  const [loadError, setLoadError] = useState(null);   // requests loaded so far; Load more adds 50
  const { isSuper } = useAuthInfo();

  useEffect(() => {
    fetchRequests();
  }, [limit]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const data = await getPendingRequests(limit);
      setRequests(data);
    } catch (err) {
      setLoadError(err.message);
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
    auditorPass: () => run(() => auditorPassRequest(req.id), `Request #${req.id} passed audit and went to the state admin.`, req.ulpin),
    auditorDelete: () => run(() => auditorApproveArchival(req.id), `Parcel ${req.ulpin} archived. Its record and history stay on file.`, req.ulpin),
    approve: (record) => run(() => approveBoundaryRequest(req.id, req, record), `Request #${req.id} approved and applied.`, req.ulpin),
    fastApprove: () => run(() => fastApproveRequest(req.id), `Correction #${req.id} approved and applied.`, req.ulpin),
    reject: (remarks) => run(() => rejectBoundaryRequest(req.id, req, remarks), `Request #${req.id} rejected. The requester sees your remarks.`, req.ulpin),
    withdraw: () => run(() => withdrawRequest(req.id), `Request #${req.id} withdrawn.`, req.ulpin),
    raise: (reason) => run(() => raiseConcern(req.id, reason), 'Concern recorded. It is now with the reviewer who holds the request.', req.ulpin),
    acknowledge: (flagId) => run(() => acknowledgeConcern(flagId), 'Concern acknowledged. It still blocks approval until resolved.', req.ulpin),
    resolve: (flagId, note) => run(() => resolveConcern(flagId, note), 'Concern resolved.', req.ulpin),
  });

  const ROLE_TITLE = { state_admin: 'State Admin Officer', auditor: 'Land Inspector and Compliance Auditor', village_officer: 'Village Land Officer', officer: 'Revenue Officer' };

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
          {loadError && <div className="callout callout--alert" role="alert">The approval queue could not be loaded. {loadError}</div>}
          {loading ? (
            <div className="note">Loading requests</div>
          ) : requests.length === 0 ? (
            <div className="note">No open requests. Every boundary change, split, merge, correction and deletion has been processed.</div>
          ) : (
            <>{requests.total > requests.length && (
              <div className="btn-row">
                <span className="subtle">Showing {requests.length} of {requests.total} open requests.</span>
                <button className="btn" onClick={() => setLimit(limit + 50)} disabled={loading}>Load more</button>
              </div>
            )}</>
          )}
          {!loading && requests.length > 0 && (
            requests.map((req) => (
              <WorkflowRequestCard key={req.id} req={req} on={cardHandlers(req)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
