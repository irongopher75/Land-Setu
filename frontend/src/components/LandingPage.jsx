import React from 'react';
import { ShieldCheck, Map, Cpu, QrCode, Layers, ArrowRight, CheckCircle2, Lock, Sparkles, Building, FileSpreadsheet } from 'lucide-react';

export default function LandingPage({ onLaunchMap, onLoginClick }) {
  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: 'var(--bg-dark)', color: 'var(--text-main)', overflowX: 'hidden' }}>
      {/* Hero Section */}
      <section style={{ padding: 'clamp(36px, 6vw, 80px) 16px clamp(30px, 5vw, 60px) 16px', maxWidth: '1200px', margin: '0 auto', textAlign: 'center', position: 'relative' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '20px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: 'var(--accent-primary)', fontSize: '0.82rem', fontWeight: 600, marginBottom: '20px' }}>
          <Sparkles size={16} /> Unified Parcel-Centric GIS Platform
        </div>

        <h1 style={{ fontFamily: 'var(--font-title)', fontSize: 'clamp(1.8rem, 5vw, 3.2rem)', fontWeight: 800, lineHeight: 1.18, color: '#12355b', maxWidth: '900px', margin: '0 auto 16px auto' }}>
          One Parcel, One Truth: Sovereign Land Governance Engine
        </h1>

        <p style={{ fontSize: 'clamp(0.92rem, 2vw, 1.15rem)', color: 'var(--text-muted)', maxWidth: '720px', margin: '0 auto 30px auto', lineHeight: 1.6 }}>
          LandSetu bridges fragmented government departments — Record of Rights, Sub-Registrar Transactions, Zoning, Municipal Permits, and Revenue Tax — using a generic config-driven schema adapter and spatial rule engine.
        </p>

        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="passport-btn"
            style={{ width: 'auto', padding: '12px 28px', fontSize: '1rem', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))' }}
            onClick={onLaunchMap}
          >
            <Map size={18} /> Launch Interactive GIS Dashboard
          </button>
        </div>

        {/* Live Metrics Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '48px', textAlign: 'left' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-card)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: 'var(--accent-cyan)', fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-title)' }}>100%</div>
            <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '4px', fontSize: '0.92rem' }}>Config-Driven Adapter</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Zero-code YAML normalization of Tamil Nadu & Chandigarh raw records</div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-card)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: '#4ade80', fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-title)' }}>5 Spatial Rules</div>
            <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '4px', fontSize: '0.92rem' }}>Explainable Rule Engine</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Real-time ST_Overlaps, eco-zone containment, and FSI checking</div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-card)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: 'var(--accent-amber)', fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-title)' }}>JWT Signed</div>
            <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '4px', fontSize: '0.92rem' }}>Verifiable QR Passport</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Cryptographic verification token generated for every ULPIN</div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-card)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: '#c084fc', fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-title)' }}>3 Access Roles</div>
            <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '4px', fontSize: '0.92rem' }}>Role-Based Access</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>Tailored visibility for Citizen, Revenue Officer, and Bank Auditor</div>
          </div>
        </div>
      </section>

      {/* Core Technology Pillars */}
      <section style={{ padding: '60px 24px', background: '#f1f6fa', borderTop: '1px solid var(--border-card)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <h2 style={{ fontFamily: 'var(--font-title)', fontSize: '2.2rem', color: 'var(--text-main)' }}>
              Built for Trusted Land Governance
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '8px' }}>
              A working end-to-end GIS vertical slice built with PostGIS, FastAPI, React, and Leaflet
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '28px' }}>
            {/* Feature 1 */}
            <div className="layer-section" style={{ padding: '24px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <Cpu color="var(--accent-cyan)" size={22} />
              </div>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--text-main)', marginBottom: '8px', fontFamily: 'var(--font-title)' }}>
                Config-Driven Schema Adapter
              </h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Each state defines declarative field mappings in YAML. The core Python engine transforms heterogeneous state land records (Tamil Nadu `pattadar_peyar` vs Chandigarh `owner_full_name`) into an identical canonical schema.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="layer-section" style={{ padding: '24px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <ShieldCheck color="#f87171" size={22} />
              </div>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--text-main)', marginBottom: '8px', fontFamily: 'var(--font-title)' }}>
                Spatial & Record Rule Engine
              </h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Automatically detects boundary overlaps (`ST_Overlaps`), protected eco-zone containment (`ST_Contains`), RoR vs Registration owner mismatches, FSI violations, and stale records with structured evidence.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="layer-section" style={{ padding: '24px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <QrCode color="#34d399" size={22} />
              </div>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--text-main)', marginBottom: '8px', fontFamily: 'var(--font-title)' }}>
                Verifiable QR Parcel Passport
              </h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Generates a cryptographically signed HMAC/JWT passport payload for any ULPIN, enabling citizens, banks, and judiciary officers to instantly verify parcel ownership and clearance status via QR code.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <footer style={{ padding: '40px 24px', textAlign: 'center', borderTop: '1px solid var(--border-card)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <p>LandSetu — Unified Land Governance Platform</p>
      </footer>
    </div>
  );
}
