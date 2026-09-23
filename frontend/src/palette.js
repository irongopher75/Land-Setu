// Canvas, Leaflet and QR code need real colour strings. Read them from the CSS tokens
// so index.css stays the only place a hex value is defined.
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const landUseColor = (landUse) => cssVar(`--land-${String(landUse || '').toLowerCase()}`) || cssVar('--land-industrial');

export const colors = () => ({
  ink: cssVar('--ink-navy'),
  parchment: cssVar('--bg-parchment'),
  surface: cssVar('--surface'),
  seal: cssVar('--accent-seal'),
  sealTint: cssVar('--accent-seal-tint'),
  sage: cssVar('--verified-sage'),
  sageInk: cssVar('--verified-ink'),
  rule: cssVar('--rule-strong'),
  protectedZone: cssVar('--land-protected'),
});
