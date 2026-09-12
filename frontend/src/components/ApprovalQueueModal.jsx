import React, { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Clock, ShieldCheck, MapPin, AlertCircle, Search, ArrowRight, UserCheck } from 'lucide-react';
import { getPendingRequests, auditorPassRequest, approveBoundaryRequest, rejectBoundaryRequest } from '../api';

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

        {role === 'village_officer' && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} color="#1d4ed8" style={{ flexShrink: 0 }} />
            <div>
              <strong>Tracking Pipeline:</strong> Requests submitted by Village Officers first go to <strong>Compliance Auditor</strong> (Stage 1), then to <strong>State Admin</strong> (Stage 2) for final authorization.
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', margin: '16px 0', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Loading pending boundary change requests...
            </div>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <CheckCircle color="#15803d" size={32} style={{ marginBottom: '8px', opacity: 0.9 }} />
              <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.95rem' }}>No Pending Requests</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                All lower authority boundary changes have been reviewed and processed through the governance pipeline.
              </div>
            </div>
          ) : (
            requests.map((req) => {
              const isStage1 = req.status === 'PENDING_AUDITOR_REVIEW' || req.status === 'PENDING';
              const isStage2 = req.status === 'PENDING_STATE_ADMIN';

              return (
                <div key={req.id} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={16} /> {req.ulpin}
                    </div>
                    {isStage1 ? (
                      <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Search size={12} /> STAGE 1: PENDING AUDITOR REVIEW
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <ShieldCheck size={12} /> STAGE 2: PENDING STATE ADMIN APPROVAL
                      </span>
                    )}
                  </div>

                  {/* Governance Pipeline Progress Tracker */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', gap: '8px', background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.76rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#059669', fontWeight: 700 }}>
                      <UserCheck size={14} /> 1. Village Request (Done)
                    </div>
                    <ArrowRight size={14} color="#94a3b8" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: isStage1 ? '#b45309' : '#059669', fontWeight: isStage1 ? 800 : 700 }}>
                      <Search size={14} /> 2. Compliance Audit ({isStage1 ? 'Active' : 'Passed ✅'})
                    </div>
                    <ArrowRight size={14} color="#94a3b8" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: isStage2 ? '#0369a1' : '#94a3b8', fontWeight: isStage2 ? 800 : 600 }}>
                      <ShieldCheck size={14} /> 3. State Admin Approval
                    </div>
                  </div>

                  <div style={{ fontSize: '0.82rem', color: '#1e293b', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '8px' }}>
                    <div>State: <strong style={{ color: '#0f172a' }}>{req.state}</strong></div>
                    <div>Proposed Area: <strong style={{ color: '#15803d' }}>{req.area_sqm} sqm</strong></div>
                    <div>Zoning Land Use: <strong style={{ color: '#1d4ed8', textTransform: 'capitalize' }}>{req.land_use || 'residential'}</strong></div>
                    <div>Requested By: <strong style={{ color: '#1d4ed8' }}>{req.requested_by}</strong> ({req.requester_role})</div>
                  </div>

                  {/* Actions according to logged in role */}
                  {role === 'auditor' && isStage1 && (
                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                      <button
                        className="passport-btn"
                        style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: 'linear-gradient(135deg, #0284c7, #0369a1)' }}
                        onClick={() => handleAuditorPass(req.id, req.ulpin)}
                      >
                        <Search size={15} /> Pass Auditor Review & Forward to State Admin
                      </button>
                      <button
                        className="passport-btn"
                        style={{ flex: 0.6, padding: '8px', fontSize: '0.82rem', background: '#ef4444' }}
                        onClick={() => handleReject(req.id, req.ulpin)}
                      >
                        <XCircle size={15} /> Reject Audit
                      </button>
                    </div>
                  )}

                  {role === 'auditor' && isStage2 && (
                    <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '0.78rem', color: '#15803d', textAlign: 'center', fontWeight: 700 }}>
                      ✅ Audit Passed — Forwarded to State Administration Officer for final signature
                    </div>
                  )}

                  {role === 'state_admin' && (
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
                        style={{ flex: 0.6, padding: '8px', fontSize: '0.82rem', background: '#ef4444' }}
                        onClick={() => handleReject(req.id, req.ulpin)}
                      >
                        <XCircle size={15} /> Reject Request
                      </button>
                    </div>
                  )}

                  {role === 'village_officer' && (
                    <div style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.78rem', color: '#475569', textAlign: 'center', fontWeight: 600 }}>
                      {isStage1 ? '🟡 Currently undergoing Stage 1 Compliance Audit Review' : '🔵 Stage 1 Passed → Awaiting Stage 2 State Admin Authorization'}
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
