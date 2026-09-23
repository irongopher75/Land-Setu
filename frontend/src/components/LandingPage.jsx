import React, { useMemo } from 'react';
import hero from '../assets/hero-parcels.json';
import '../landing.css';

// Real seed geometry (backend/mock_data/tamilnadu_geometries.geojson) projected into a 1200 x 700 sheet.
const SHEET = { w: 1200, h: 900, left: 40, top: 400, mapW: 1120 };
const KEY_X = 984;

function useProjection() {
  return useMemo(() => {
    const all = [...hero.parcels.flatMap((p) => p.ring), ...hero.zone.ring];
    const lon0 = Math.min(...all.map((c) => c[0]));
    const lon1 = Math.max(...all.map((c) => c[0]));
    const lat1 = Math.max(...all.map((c) => c[1]));
    const cosLat = Math.cos(((lat1 + Math.min(...all.map((c) => c[1]))) / 2) * (Math.PI / 180));
    const scale = SHEET.mapW / ((lon1 - lon0) * cosLat); // sheet units per degree of latitude
    const x = (lon) => SHEET.left + (lon - lon0) * cosLat * scale;
    const y = (lat) => SHEET.top + (lat1 - lat) * scale;
    const metresPerUnit = 111139 / scale;
    const path = (ring) => `M${ring.map((c) => `${x(c[0]).toFixed(1)} ${y(c[1]).toFixed(1)}`).join('L')}Z`;
    const centroid = (ring) => {
      const pts = ring.slice(0, -1);
      return [pts.reduce((a, c) => a + x(c[0]), 0) / pts.length, pts.reduce((a, c) => a + y(c[1]), 0) / pts.length];
    };
    const bounds = (ring) => {
      const xs = ring.map((c) => x(c[0]));
      const ys = ring.map((c) => y(c[1]));
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    };
    return { x, y, path, centroid, bounds, metresPerUnit };
  }, []);
}

const byId = (id) => hero.parcels.find((p) => p.ulpin.endsWith(id));

function Pin({ n, at }) {
  return (
    <g className="pin" transform={`translate(${at[0].toFixed(1)} ${at[1].toFixed(1)})`}>
      <circle r="12" />
      <text y="5" textAnchor="middle">{n}</text>
    </g>
  );
}

// Key entry beside the map. Numbered pins avoid leader lines running across other parcels.
function KeyEntry({ n, y, lines }) {
  return (
    <g className="key-entry">
      <circle className="key-pin" cx={KEY_X} cy={y - 5} r="12" />
      <text className="key-n" x={KEY_X} y={y} textAnchor="middle">{n}</text>
      {lines.map((l, i) => (
        <text key={l.text} className={l.mono ? 'callout-id' : i === 0 ? 'callout-head' : 'callout-line'} x={KEY_X + 22} y={y + i * 18}>{l.text}</text>
      ))}
    </g>
  );
}

export default function LandingPage({ onLaunchMap, onLoginClick }) {
  const P = useProjection();
  const p1189 = byId('1189');
  const p1190 = byId('1190');
  const p1195 = byId('1195');
  const ovA = hero.overlaps[0];
  const zoneB = P.bounds(hero.zone.ring);
  const scaleBar = 200 / P.metresPerUnit;

  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <svg className="hero-sheet" viewBox={`0 0 ${SHEET.w} ${SHEET.h}`} preserveAspectRatio="xMidYMax meet" role="img"
          aria-label="Survey sheet of nine parcels in Chennai showing one ownership mismatch, two boundary overlaps, one zoning violation and one active mortgage">
          <rect className="sheet-frame" pathLength="1" x="16" y="16" width={SHEET.w - 32} height={SHEET.h - 32} />

          {/* Protected zone runs under the parcels */}
          <path className="zone" d={P.path(hero.zone.ring)} />
          <text className="zone-label" x={zoneB.minX + 12} y={(zoneB.minY + zoneB.maxY) / 2 + 4}>{hero.zone.name}, protected</text>

          <g className="parcels">
            {hero.parcels.map((p, i) => (
              <path key={p.ulpin} className={`parcel ${p.flags.length ? 'is-flagged' : ''}`} style={{ '--i': i }} d={P.path(p.ring)} pathLength="1" />
            ))}
          </g>
          <g className="overlaps">
            {hero.overlaps.map((o) => <path key={o.a + o.b} className="overlap" d={P.path(o.ring)} />)}
          </g>

          <g className="pins">
            <Pin n="1" at={P.centroid(p1189.ring)} />
            <Pin n="2" at={P.centroid(ovA.ring)} />
            <Pin n="3" at={P.centroid(p1190.ring)} />
            <Pin n="4" at={P.centroid(p1195.ring)} />
          </g>
          <g className="key">
            <KeyEntry n="1" y={430} lines={[{ text: 'Owner names disagree' }, { text: 'RoR: V. Ramanathan' }, { text: 'Deed: A. Sundaram' }, { text: p1189.ulpin, mono: true }]} />
            <KeyEntry n="2" y={516} lines={[{ text: 'Boundaries overlap' }, { text: `${Math.round(ovA.area_sqm).toLocaleString('en-IN')} sq m shared` }, { text: `${ovA.a.slice(-4)} and ${ovA.b.slice(-4)}`, mono: true }]} />
            <KeyEntry n="3" y={592} lines={[{ text: 'Permit exceeds zoning' }, { text: `FSI ${p1190.approved_fsi} against ${p1190.permitted_fsi}` }, { text: p1190.ulpin, mono: true }]} />
            <KeyEntry n="4" y={668} lines={[{ text: 'Active mortgage' }, { text: 'Registered charge' }, { text: p1195.ulpin, mono: true }]} />
          </g>

          {/* Scale bar and north arrow: sheet furniture that carries real information */}
          <g className="scalebar" transform={`translate(${SHEET.left + 8} ${SHEET.h - 46})`}>
            <path d={`M0 0V8M${scaleBar} 0V8M0 8H${scaleBar}`} />
            <text x="0" y="24">200 m</text>
          </g>
          <g className="north" transform={`translate(${SHEET.w - 70} ${SHEET.h - 64})`}>
            <path d="M0 -14L8 10L0 4L-8 10Z" />
            <text x="0" y="28" textAnchor="middle">N</text>
          </g>
        </svg>

        <div className="hero-copy">
          <p className="hero-kicker">Chennai, Nemili Revenue Village. Nine parcels, seeded records.</p>
          <h1 id="hero-title">Five departments hold one plot. Their records do not agree.</h1>
          <p className="hero-lede">
            LandSetu reads the Record of Rights, the Sub-Registrar deed, the zoning map, the building permit and the
            tax roll against a single ULPIN, and shows exactly where they differ.
          </p>
          <div className="hero-actions">
            <button className="btn btn--primary" onClick={onLaunchMap}>Open the parcel map</button>
            <button className="btn" onClick={onLoginClick}>Sign in</button>
          </div>
        </div>
      </section>

      <section className="ledger" aria-labelledby="ledger-title">
        <h2 id="ledger-title">Who holds what today</h2>
        <p className="ledger-intro">
          Each department keeps its own register, in its own format, under its own identifier. A buyer, a bank or a
          court has to visit all five and reconcile them by hand.
        </p>
        <table className="data-table ledger-table">
          <thead>
            <tr><th scope="col">Department</th><th scope="col">Register</th><th scope="col">Answers</th><th scope="col">Typical gap</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Revenue</th><td>Record of Rights, khata</td><td>Who is the owner of record</td><td>Owner not updated after sale</td></tr>
            <tr><th scope="row">Sub-Registrar</th><td>Deed of registration</td><td>Who bought it, and when</td><td>Deed buyer differs from RoR owner</td></tr>
            <tr><th scope="row">Town planning</th><td>Master plan zoning</td><td>What may be built, at what FSI</td><td>Permit approved above the limit</td></tr>
            <tr><th scope="row">Municipal corporation</th><td>Building permit</td><td>What was approved</td><td>Permit issued inside a protected zone</td></tr>
            <tr><th scope="row">Revenue, tax</th><td>Property tax roll</td><td>Who pays, on what value</td><td>Assessment years out of date</td></tr>
          </tbody>
        </table>
      </section>

      <section className="checks" aria-labelledby="checks-title">
        <h2 id="checks-title">What the rule engine checks on every parcel</h2>
        <ol className="checks-list">
          <li><span className="checks-name">Boundary overlap</span><span>Interiors that intersect another parcel in the same state, with the shared area in square metres, measured on the ellipsoid.</span></li>
          <li><span className="checks-name">Protected zone</span><span>Any intersection with a notified eco-sensitive area, named with its zone id.</span></li>
          <li><span className="checks-name">Ownership mismatch</span><span>Record of Rights owner against Sub-Registrar buyer, shown side by side.</span></li>
          <li><span className="checks-name">FSI violation</span><span>Approved permit FSI against the zoning limit, with the excess.</span></li>
          <li><span className="checks-name">Active encumbrance</span><span>Mortgage or legal charge registered against the parcel.</span></li>
        </ol>
        <p className="checks-note">Every field carries its source department and a confidence label: verified, self-declared or stale.</p>
      </section>

      <section className="roles" aria-labelledby="roles-title">
        <h2 id="roles-title">Who can do what</h2>
        <dl className="roles-list">
          <div><dt>Citizen</dt><dd>Search a parcel, read its record, request a correction with a supporting document.</dd></div>
          <div><dt>Village land officer</dt><dd>Verify corrections, file boundary edits, splits and merges.</dd></div>
          <div><dt>Auditor</dt><dd>Review every request before it reaches the state, and authorize deletions.</dd></div>
          <div><dt>State admin</dt><dd>Give final approval, request deletions, read state-wide counts.</dd></div>
        </dl>
      </section>

      <footer className="landing-foot">
        <p><strong>LandSetu</strong>. All parcels, owners and identifiers in this demo are synthetic.</p>
        <div>
          <a href="#tos" onClick={(e) => { e.preventDefault(); alert('Terms of Service: authorized government and public access only. All land records are synthetic demonstration data.'); }}>Terms of Service</a>
          <a href="#privacy" onClick={(e) => { e.preventDefault(); alert('Privacy Policy: this demo uses synthetic data only. No personal data is collected.'); }}>Privacy Policy</a>
        </div>
      </footer>
    </div>
  );
}
