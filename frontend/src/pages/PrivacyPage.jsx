import React from 'react';
import PageShell from '../components/PageShell';

export default function PrivacyPage() {
  return (
    <PageShell title="Privacy policy" draft>
      <h2>What we collect</h2>
      <p>If you sign in: your email address, display name and the time of your last sign-in. If you file a correction request: the request text, the name you enter and the document reference you give.</p>
      <p>The site also keeps your language choice and some working data in your browser. That data stays on your device.</p>
      <h2>What we do not collect</h2>
      <p>No advertising or tracking cookies are used. The demonstration DigiLocker sign-in is a simulation. It does not contact any Aadhaar or DigiLocker service and does not read any real identity data.</p>
      <h2>How it is used</h2>
      <p>To sign you in, to show your correction requests to the officers who review them, and to keep a log of decisions.</p>
      <h2>Who sees it</h2>
      <p>Officers in the review chain see the correction requests assigned to them. Sign-in is provided by an outside identity service that processes your email address.</p>
      <h2>Keeping and deleting</h2>
      <p>Retention periods are not set for the prototype. Ask for an account to be deleted at grievance@landsetu-demo.example (placeholder).</p>
      <h2>Your data is synthetic</h2>
      <p>All land records shown are synthetic. Please do not enter real personal data.</p>
    </PageShell>
  );
}
