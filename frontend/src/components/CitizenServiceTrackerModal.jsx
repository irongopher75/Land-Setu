import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Clock, ShieldCheck, FileText, Send, AlertTriangle, MessageSquare, Mail, Bell } from 'lucide-react';

export default function CitizenServiceTrackerModal({ initialUlpin, onClose }) {
  const [activeTab, setActiveTab] = useState('track'); // 'track' | 'new'
  const [requests, setRequests] = useState([]);
  const [selectedReq, setSelectedReq] = useState(null);
  const [notifications, setNotifications] = useState([]);

  // New Request Form state
  const [ulpin, setUlpin] = useState(initialUlpin || 'TN-CHN-0042-1187');
  const [citizenName, setCitizenName] = useState('R. Kannan');
  const [mobile, setMobile] = useState('+91 98765 43210');
  const [email, setEmail] = useState('kannan.r@gov.in');
  const [serviceType, setServiceType] = useState('MUTATION');
  const [remarks, setRemarks] = useState('Requesting ownership name change following sub-registrar deed REG-2023-88213.');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(null);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = () => {
    const savedReqs = JSON.parse(localStorage.getItem('landsetu_citizen_service_reqs') || '[]');
    if (savedReqs.length === 0) {
      // Default seed requests
      const seedReqs = [
        {
          id: 'SR-2026-9901',
          ulpin: 'TN-CHN-0042-1187',
          service_type: 'Land Mutation (Name Change)',
          citizen_name: 'R. Kannan',
          mobile: '+91 98765 43210',
          email: 'kannan.r@gov.in',
          status: 'VILLAGE_OFFICER_REVIEW',
          stage_label: 'Stage 2: Village Officer Desk Verification',
          created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
          history: [
            { step: 'SUBMITTED', title: 'Application Submitted', desc: 'Received via LandSetu Citizen Portal', time: '2 days ago', status: 'completed' },
            { step: 'VILLAGE_OFFICER_REVIEW', title: 'Village Officer Verification', desc: 'Under review by Village Officer (Nemili Circle)', time: 'In Progress', status: 'active' },
            { step: 'AUDITOR_CHECK', title: 'Compliance Audit & GIS Rules', desc: 'Rule Engine overlap and eco-zone verification', time: 'Pending', status: 'pending' },
            { step: 'PASSPORT_ISSUED', title: 'Final Passport Update', desc: 'Updated Record of Rights & Land Passport QR', time: 'Pending', status: 'pending' }
          ]
        },
        {
          id: 'SR-2026-4412',
          ulpin: 'CHD-SEC17-0094',
          service_type: 'Encumbrance Certificate (EC)',
          citizen_name: 'Gurpreet Singh',
          mobile: '+91 98123 99887',
          email: 'gurpreet.chd@gov.in',
          status: 'COMPLETED',
          stage_label: 'Stage 4: Completed & Digitally Signed',
          created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
          history: [
            { step: 'SUBMITTED', title: 'Application Submitted', desc: 'Received via LandSetu Citizen Portal', time: '5 days ago', status: 'completed' },
            { step: 'VILLAGE_OFFICER_REVIEW', title: 'Village Officer Verification', desc: 'Verified by Tehsil Revenue Inspector', time: '4 days ago', status: 'completed' },
            { step: 'AUDITOR_CHECK', title: 'Compliance Audit', desc: 'Encumbrance-free status verified by Auditor', time: '2 days ago', status: 'completed' },
            { step: 'PASSPORT_ISSUED', title: 'EC Issued & Signed', desc: 'Digitally signed EC issued to citizen portal', time: 'Yesterday', status: 'completed' }
          ]
        }
      ];
      localStorage.setItem('landsetu_citizen_service_reqs', JSON.stringify(seedReqs));
      setRequests(seedReqs);
      setSelectedReq(seedReqs[0]);
    } else {
      setRequests(savedReqs);
      setSelectedReq(savedReqs[0]);
    }
  };

  const handleCreateRequest = (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const reqId = 'SR-2026-' + Math.floor(1000 + Math.random() * 9000);
    const newReq = {
      id: reqId,
      ulpin,
      service_type: serviceType === 'MUTATION' ? 'Land Mutation (Name Change)' : serviceType === 'BOUNDARY' ? 'Boundary Verification' : 'Encumbrance Certificate',
      citizen_name: citizenName,
      mobile,
      email,
      status: 'SUBMITTED',
      stage_label: 'Stage 1: Application Received',
      created_at: new Date().toISOString(),
      history: [
        { step: 'SUBMITTED', title: 'Application Submitted', desc: `Filed by ${citizenName}`, time: 'Just now', status: 'active' },
        { step: 'VILLAGE_OFFICER_REVIEW', title: 'Village Officer Verification', desc: 'Awaiting Village Officer Review', time: 'Next step', status: 'pending' },
        { step: 'AUDITOR_CHECK', title: 'Compliance Audit & GIS Rules', desc: 'Spatial Rule Engine verification', time: 'Pending', status: 'pending' },
        { step: 'PASSPORT_ISSUED', title: 'Final Passport Update', desc: 'Updated Land Passport & QR Certificate', time: 'Pending', status: 'pending' }
      ]
    };

    const updated = [newReq, ...requests];
    localStorage.setItem('landsetu_citizen_service_reqs', JSON.stringify(updated));
    setRequests(updated);
    setSelectedReq(newReq);
    setIsSubmitting(false);
    setSubmitSuccess(reqId);

    // Trigger simulated SMS & Email notifications
    const newNotif = [
      { id: Date.now() + 1, type: 'SMS', to: mobile, msg: `[LandSetu] Your service request ${reqId} for ULPIN ${ulpin} has been submitted. Track status at landsetu.gov.in/track/${reqId}` },
      { id: Date.now() + 2, type: 'Email', to: email, msg: `[LandSetu Portal] Application ${reqId} received. Verification pipeline initiated.` }
    ];
    setNotifications(newNotif);
    setActiveTab('track');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content glass-card" style={{ maxWidth: '850px', width: '92vw', padding: '1.75rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={22} color="#60a5fa" /> Citizen Land Service Portal & Real-time Tracker
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.825rem', margin: '0.25rem 0 0' }}>
              File land service requests and track multi-tier governance progress transparently.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <button
            onClick={() => setActiveTab('track')}
            className={`btn-secondary ${activeTab === 'track' ? 'active-tab' : ''}`}
            style={{ padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Clock size={16} /> Active Service Tracker ({requests.length})
          </button>
          <button
            onClick={() => setActiveTab('new')}
            className={`btn-secondary ${activeTab === 'new' ? 'active-tab' : ''}`}
            style={{ padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Send size={16} /> File New Service Request
          </button>
        </div>

        {activeTab === 'track' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '1.25rem' }}>
            {/* Left Column: Request List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '420px', overflowY: 'auto' }}>
              {requests.map(req => (
                <div
                  key={req.id}
                  onClick={() => setSelectedReq(req)}
                  style={{
                    padding: '0.85rem',
                    borderRadius: '8px',
                    background: selectedReq?.id === req.id ? 'rgba(59, 130, 246, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                    border: selectedReq?.id === req.id ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#60a5fa' }}>{req.id}</span>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      background: req.status === 'COMPLETED' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                      color: req.status === 'COMPLETED' ? '#4ade80' : '#fde047'
                    }}>
                      {req.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#f8fafc', fontWeight: 500 }}>{req.service_type}</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>ULPIN: {req.ulpin}</div>
                </div>
              ))}
            </div>

            {/* Right Column: Timeline Tracker & Details */}
            {selectedReq && (
              <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: '1.25rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>{selectedReq.service_type}</div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.15rem' }}>Request ID: <span style={{ color: '#60a5fa' }}>{selectedReq.id}</span> • ULPIN: {selectedReq.ulpin}</div>
                  <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '0.35rem', fontWeight: 500 }}>{selectedReq.stage_label}</div>
                </div>

                {/* Progress Timeline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                  {selectedReq.history.map((h, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: h.status === 'completed' ? '#16a34a' : h.status === 'active' ? '#3b82f6' : '#334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        flexShrink: 0
                      }}>
                        {h.status === 'completed' ? <CheckCircle size={14} /> : idx + 1}
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: h.status === 'pending' ? '#64748b' : '#f8fafc' }}>{h.title}</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{h.desc}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.1rem' }}>{h.time}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Simulated SMS & Email Notifications Banner */}
                {notifications.length > 0 && (
                  <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '0.75rem', borderRadius: '6px', border: '1px dashed #3b82f6' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.4rem' }}>
                      <Bell size={14} /> Multi-Channel Dispatch Alert (Simulated SMS & Email)
                    </div>
                    {notifications.map(n => (
                      <div key={n.id} style={{ fontSize: '0.7rem', color: '#cbd5e1', marginBottom: '0.25rem' }}>
                        <strong>[{n.type} to {n.to}]</strong>: {n.msg}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'new' && (
          <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '600px', margin: '0 auto' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>Target Land Parcel ULPIN</label>
              <input
                type="text"
                value={ulpin}
                onChange={e => setUlpin(e.target.value)}
                required
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>Applicant Citizen Name</label>
                <input
                  type="text"
                  value={citizenName}
                  onChange={e => setCitizenName(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>Service Type</label>
                <select
                  value={serviceType}
                  onChange={e => setServiceType(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                >
                  <option value="MUTATION">Land Mutation (Name Change)</option>
                  <option value="BOUNDARY">Boundary Verification & Reshaping</option>
                  <option value="EC">Encumbrance Certificate (EC)</option>
                  <option value="CONVERSION">Land Use Conversion (Agri to Non-Agri)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>SMS Alert Mobile Number</label>
                <input
                  type="text"
                  value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>Email Notification Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: '#cbd5e1', display: 'block', marginBottom: '0.35rem' }}>Application Grounds & Remarks</label>
              <textarea
                rows={3}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{ padding: '0.75rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.9rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <Send size={18} /> Submit Official Land Service Request
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
