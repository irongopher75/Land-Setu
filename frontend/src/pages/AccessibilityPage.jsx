import React from 'react';
import PageShell from '../components/PageShell';

export default function AccessibilityPage() {
  return (
    <PageShell title="Accessibility statement" draft>
      <p>LandSetu aims to meet WCAG 2.1 level AA. It has not been formally audited.</p>
      <h2>What is in place</h2>
      <ul className="plain-list">
        <li>A skip link to the main content on every page.</li>
        <li>Visible keyboard focus and full keyboard use of navigation and forms.</li>
        <li>Text contrast of at least 4.5 to 1 on the parchment background.</li>
        <li>Status shown with text and pattern as well as colour. A flag is a labelled badge and a dashed outline, never colour alone.</li>
        <li>Motion on the home page plays once and stops. It is skipped when your device asks for reduced motion.</li>
        <li>The interface can be shown in English and eleven Indian languages: Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Odia, Punjabi and Assamese. These cover navigation, the footer and the home page only for now, and the translations are drafts awaiting review.</li>
      </ul>
      <h2>Known gaps</h2>
      <ul className="plain-list">
        <li>The parcel map is a visual tool. Screen reader users can use Search, which lists parcels and opens each record as text.</li>
        <li>Text pages are English only.</li>
      </ul>
      <h2>Report a problem</h2>
      <p>Write to grievance@landsetu-demo.example (placeholder) and describe the page and the difficulty.</p>
    </PageShell>
  );
}
