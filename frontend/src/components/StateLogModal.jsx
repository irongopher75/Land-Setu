import React from 'react';
import { X } from 'lucide-react';
import AuditLogViewer from './AuditLogViewer';

// State activity: the records service's audit log. It replaces an activity stream that was assembled in the
// browser from parcel copies and placeholder hashes.
export default function StateLogModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--xwide" role="dialog" aria-modal="true" aria-label="State activity" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>State activity</h3>
            <p>Every recorded change, from the records service's audit log.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <AuditLogViewer />
      </div>
    </div>
  );
}
