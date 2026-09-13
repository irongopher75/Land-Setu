import React, { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Clock, ShieldCheck, MapPin, AlertCircle, Search, ArrowRight, UserCheck, Trash2, ShieldAlert } from 'lucide-react';
import { getPendingRequests, auditorPassRequest, approveBoundaryRequest, rejectBoundaryRequest, villageApproveDeletion, auditorApproveDeletion } from '../api';

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

  const handleAuditorPass = async (id, ulpin) => {
    try {
      await auditorPassRequest(id);
      setActionMsg(`Request #${id} for ULPIN '${ulpin}' passed auditor review & forwarded to State Admin!`);
      await fetchRequests();
      if (onRequestProcessed) onRequestProcessed(ulpin);
    } catch (err) {
      alert(err.response?.data?.detail || err.message);
    }
  };

  const handleApprove = async (id, ulpin) => {
    try {
      const res = await approveBoundaryRequest(id);
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
      <div className="modal-card" style={{ maxWidth: '680px', width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-card)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck color="#fff" size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.15rem', color: '#0f172a', fontFamily: 'var(--font-title)' }}>
                Multi-Stage Governance Approval Pipeline
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Review Panel — Active Role: <strong>{role === 'state_admin' ? '🛡️ State Admin Officer' : role === 'auditor' ? '🔍 Land Inspector & Compliance Auditor' : '🏛️ Village Land Officer'}</strong>
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

        <div style={{ flex: 1, overflowY: 'auto', margin: '16px 0', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Loading pending governance requests...
            </div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <CheckCircle color="#15803d" size={32} style={{ marginBottom: '8px', opacity: 0.9 }} />
              <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.95rem' }}>No Pending Requests</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                All boundary modifications and land deletion requests have been processed.
              </div>
            </div>
          ) : (
            requests.map((req) => {
              const isDeletion = req.status === 'PENDING_DELETION_VILLAGE' || req.status === 'PENDING_DELETION_AUDITOR' || req.type === 'DELETION';
              const isStage1 = req.status === 'PENDING_AUDITOR_REVIEW' || req.status === 'PENDING' || req.status === 'PENDING_DELETION_VILLAGE';
              const isStage2 = req.status === 'PENDING_STATE_ADMIN' || req.status === 'PENDING_DELETION_AUDITOR';

              return (
                <div key={req.id} style={{ background: '#ffffff', border: isDeletion ? '1.5px solid #fca5a5' : '1px solid #cbd5e1', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 700, color: isDeletion ? '#dc2626' : 'var(--accent-primary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isDeletion ? <Trash2 size={16} color="#dc2626" /> : <MapPin size={16} />}
                      {req.ulpin} {isDeletion && <span style={{ fontSize: '0.75rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '2px 6px', borderRadius: '6px' }}>DELETION REQUEST</span>}
                    </div>
                    {isDeletion ? (
                      req.status === 'PENDING_DELETION_VILLAGE' ? (
                        <span style={{ fontSize: '0.72rem', background: '#fff7ed', color: '#c2410c', border: '1px solid #ffedd5', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <UserCheck size={12} /> STAGE 1: PENDING VILLAGE OFFICER APPROVAL
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.72rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <ShieldAlert size={12} /> STAGE 2: PENDING AUDITOR AUTHORIZATION
                        </span>
                      )
                    ) : isStage1 ? (
                      <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Search size={12} /> STAGE 1: PENDING AUDITOR REVIEW
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <ShieldCheck size={12} /> STAGE 2: PENDING STATE ADMIN APPROVAL
                      </span>
                    )}
                  </div>

                  {/* Multi-Stage Pipeline Visual Tracker */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: isDeletion ? '#fff5f5' : '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.76rem' }}>
                    {isDeletion ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontWeight: 700 }}>
                          <ShieldCheck size={13} /> 1. State Admin Initiated
                        </div>
                        <ArrowRight size={13} color="#94a3b8" />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: req.status === 'PENDING_DELETION_VILLAGE' ? '#c2410c' : '#059669', fontWeight: req.status === 'PENDING_DELETION_VILLAGE' ? 800 : 700 }}>
                          <UserCheck size={13} /> 2. Village Officer ({req.status === 'PENDING_DELETION_VILLAGE' ? 'Active' : 'Approved ✅'})
                        </div>
                        <ArrowRight size={13} color="#94a3b8" />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: req.status === 'PENDING_DELETION_AUDITOR' ? '#dc2626' : '#94a3b8', fontWeight: req.status === 'PENDING_DELETION_AUDITOR' ? 800 : 600 }}>
                          <ShieldAlert size={13} /> 3. Auditor Authorization
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#059669', fontWeight: 700 }}>
                          <UserCheck size={13} /> 1. Village Request
                        </div>
                        <ArrowRight size={13} color="#94a3b8" />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: isStage1 ? '#b45309' : '#059669', fontWeight: isStage1 ? 800 : 700 }}>
                          <Search size={13} /> 2. Audit Review ({isStage1 ? 'Active' : 'Passed ✅'})
                        </div>
                        <ArrowRight size={13} color="#94a3b8" />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: isStage2 ? '#0369a1' : '#94a3b8', fontWeight: isStage2 ? 800 : 600 }}>
                          <ShieldCheck size={13} /> 3. State Admin Approval
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ fontSize: '0.82rem', color: '#1e293b', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '8px' }}>
                    <div>Type: <strong style={{ color: isDeletion ? '#dc2626' : '#0369a1' }}>{isDeletion ? 'Land Parcel Deletion' : 'Boundary Reshape'}</strong></div>
                    <div>Requested By: <strong style={{ color: '#1d4ed8' }}>{req.requested_by}</strong> ({req.requester_role})</div>
                    <div style={{ gridColumn: 'span 2' }}>Reason / Notes: <strong style={{ color: '#475569' }}>{req.reason || 'N/A'}</strong></div>
                  </div>

                  {/* DELETION PIPELINE ACTIONS */}
                  {isDeletion ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
                      {role === 'state_admin' && (
                        <div style={{ background: '#fff7ed', border: '1px solid #ffedd5', color: '#9a3412', padding: '8px 10px', borderRadius: '8px', fontSize: '0.78rem' }}>
                          You initiated this deletion. Village Land Officer and Compliance Auditor must each approve before the parcel is removed. You cannot self-approve.
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '10px' }}>
                      {req.status === 'PENDING_DELETION_VILLAGE' && role === 'village_officer' && (
                        <button
                          className="passport-btn"
                          style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #ea580c, #c2410c)' }}
                          onClick={() => handleVillageApproveDeletion(req.id, req.ulpin)}
                        >
                          <UserCheck size={15} /> Approve deletion (Village Officer)
                        </button>
                      )}

                      {req.status === 'PENDING_DELETION_AUDITOR' && role === 'auditor' && (
                        <button
                          className="passport-btn"
                          style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #dc2626, #991b1b)' }}
                          onClick={() => handleAuditorApproveDeletion(req.id, req.ulpin)}
                        >
                          <Trash2 size={15} /> Authorize deletion (Auditor)
                        </button>
                      )}

                      {((req.status === 'PENDING_DELETION_VILLAGE' && (role === 'village_officer' || role === 'state_admin')) ||
                        (req.status === 'PENDING_DELETION_AUDITOR' && (role === 'auditor' || role === 'state_admin'))) && (
                      <button
                        className="passport-btn"
                        style={{ flex: 0.5, padding: '8px', fontSize: '0.82rem', background: '#64748b' }}
                        onClick={() => handleReject(req.id, req.ulpin)}
                      >
                        <XCircle size={15} /> {role === 'state_admin' ? 'Withdraw' : 'Reject'}
                      </button>
                      )}
                      </div>
                    </div>
                  ) : (
                    /* BOUNDARY CHANGE ACTIONS */
                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                      {role === 'auditor' && isStage1 && (
                        <button
                          className="passport-btn"
                          style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #0284c7, #0369a1)' }}
                          onClick={() => handleAuditorPass(req.id, req.ulpin)}
                        >
                          <Search size={15} /> Pass Auditor Review & Forward to State Admin
                        </button>
                      )}

                      {role === 'state_admin' && (
                        <button
                          className="passport-btn"
                          style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #10b981, #059669)' }}
                          onClick={() => handleApprove(req.id, req.ulpin)}
                        >
                          <CheckCircle size={15} /> Approve & Commit Boundary
                        </button>
                      )}

                      <button
                        className="passport-btn"
                        style={{ flex: 0.5, padding: '8px', fontSize: '0.82rem', background: '#ef4444' }}
                        onClick={() => handleReject(req.id, req.ulpin)}
                      >
                        <XCircle size={15} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
