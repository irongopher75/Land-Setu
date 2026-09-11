import React, { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Clock, ShieldCheck, MapPin, AlertCircle } from 'lucide-react';
import { getPendingRequests, approveBoundaryRequest, rejectBoundaryRequest } from '../api';

export default function ApprovalQueueModal({ onClose, onRequestProcessed, role }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

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

  const handleApprove = async (id, ulpin) => {
    try {
      const res = await approveBoundaryRequest(id);
      setActionMsg(`Request #${id} for ULPIN '${ulpin}' approved and committed to master GIS database!`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed();
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  const handleReject = async (id, ulpin) => {
    try {
      await rejectBoundaryRequest(id);
      setActionMsg(`Request #${id} for ULPIN '${ulpin}' rejected.`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed();
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ maxWidth: '650px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-card)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck color="#fff" size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.15rem', color: '#0f172a', fontFamily: 'var(--font-title)' }}>
                Boundary Change Approval Queue
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Upper Authority Review Panel ({role === 'state_admin' ? 'State Admin' : 'Auditor'})
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {actionMsg && (
          <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', color: '#15803d', padding: '10px 14px', borderRadius: '8px', fontSize: '0.82rem', marginTop: '12px' }}>
            {actionMsg}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', margin: '16px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Loading pending boundary change requests...
            </div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <CheckCircle color="#15803d" size={32} style={{ marginBottom: '8px', opacity: 0.9 }} />
              <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.95rem' }}>No Pending Requests</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                All lower authority boundary changes have been reviewed and processed.
              </div>
            </div>
          ) : (
            requests.map((req) => (
              <div key={req.id} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={16} /> {req.ulpin}
                  </div>
                  <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>
                    PENDING APPROVAL
                  </span>
                </div>

                <div style={{ fontSize: '0.82rem', color: '#1e293b', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '8px' }}>
                  <div>State: <strong style={{ color: '#0f172a' }}>{req.state}</strong></div>
                  <div>Proposed Area: <strong style={{ color: '#15803d' }}>{req.area_sqm} sqm</strong></div>
                  <div>Requested By: <strong style={{ color: '#1d4ed8' }}>{req.requested_by}</strong> ({req.requester_role})</div>
                  <div>Submitted: <strong style={{ color: 'var(--text-muted)' }}>{new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                  <button
                    className="passport-btn"
                    style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #10b981, #059669)' }}
                    onClick={() => handleApprove(req.id, req.ulpin)}
                  >
                    <CheckCircle size={15} /> Approve & Commit Boundary
                  </button>
                  <button
                    className="passport-btn"
                    style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: '#ef4444' }}
                    onClick={() => handleReject(req.id, req.ulpin)}
                  >
                    <XCircle size={15} /> Reject Request
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
