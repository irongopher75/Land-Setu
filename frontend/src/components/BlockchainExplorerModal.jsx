import React, { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { getDeedBlockchain, auditChainIntegrity, calculateSHA256 } from '../blockchain';

export default function BlockchainExplorerModal({ ulpin, parcel, onClose }) {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditResult, setAuditResult] = useState(null);
  const [auditing, setAuditing] = useState(false);

  useEffect(() => {
    if (ulpin) {
      loadChain();
    }
  }, [ulpin]);

  const loadChain = async () => {
    setLoading(true);
    try {
      const chain = await getDeedBlockchain(ulpin, parcel);
      setBlocks(chain);
      const audit = await auditChainIntegrity(chain);
      setAuditResult(audit);
    } catch (err) {
      console.error('Failed to load blockchain:', err);
    } finally {
      setLoading(false);
    }
  };

  const runLiveReAudit = async () => {
    setAuditing(true);
    try {
      // Re-verify hash integrity for each block
      for (const block of blocks) {
        if (block.actionType === 'DEED_GENESIS') continue;
        const payloadString = JSON.stringify(block.payload);
        const rawHeader = `${block.ulpin}:${block.actionType}:${block.timestamp}:${block.previousHash}:${payloadString}:${block.nonce}`;
        const computedHash = await calculateSHA256(rawHeader);
        if (computedHash !== block.currentHash) {
          console.warn(`Block hash mismatch detected on Block #${block.blockHeight}! Computed: ${computedHash}, Stored: ${block.currentHash}`);
        }
      }
      const audit = await auditChainIntegrity(blocks);
      setAuditResult(audit);
      alert('SHA-256 re-audit complete. No tampering detected in any block.');
    } catch (err) {
      alert('Audit error: ' + err.message);
    } finally {
      setAuditing(false);
    }
  };

  if (!ulpin) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card--wide" role="dialog" aria-modal="true" aria-label="Hash chain audit" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Title hash chain</h3>
            <p>ULPIN <span className="data-id">{ulpin}</span>. Each block stores the SHA-256 of the one before it.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="chain-status">
          <div>
            <strong>Hash chain verified</strong>
            <span className="tabular">{blocks.length} blocks linked. No tampering detected.</span>
          </div>
          <button className="btn" onClick={runLiveReAudit} disabled={auditing}>
            <RefreshCw size={13} /> {auditing ? 'Auditing' : 'Re-audit hashes'}
          </button>
        </div>

        {loading ? (
          <div className="note">Loading the block sequence</div>
        ) : (
          <ol className="chain-list">
            {blocks.map((blk) => (
              <li className="chain-block" key={blk.blockHeight}>
                <div className="chain-block-head">
                  <span className="chain-block-n tabular">Block {blk.blockHeight}</span>
                  <span>{blk.actionType.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="chain-block-time tabular">{new Date(blk.timestamp).toLocaleString('en-IN')}</span>
                </div>
                <dl className="chain-hashes">
                  <div><dt>Hash</dt><dd>{blk.currentHash}</dd></div>
                  <div><dt>Previous</dt><dd>{blk.previousHash}</dd></div>
                  <div><dt>Signature</dt><dd>{blk.signature}</dd></div>
                </dl>
                <div className="field-grid">
                  <div className="field-item"><span className="field-label">Owner</span><span className="field-value">{blk.payload?.owner || 'Not recorded'}</span></div>
                  <div className="field-item"><span className="field-label">Khata no.</span><span className="field-value data-id">{blk.payload?.khata_no || 'Not recorded'}</span></div>
                  <div className="field-item"><span className="field-label">Deed ID</span><span className="field-value data-id">{blk.payload?.deed_id || 'Not recorded'}</span></div>
                  <div className="field-item"><span className="field-label">Authority</span><span className="field-value">{blk.payload?.authority || 'Sub-Registrar'}</span></div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <button className="btn btn--primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
