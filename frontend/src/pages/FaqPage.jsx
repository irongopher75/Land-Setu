import React from 'react';
import PageShell from '../components/PageShell';

const QA = [
  ['What is a ULPIN?', 'A Unique Land Parcel Identification Number. It is one number for one parcel, so records from different departments can be matched.'],
  ['What is a khata number?', 'The account number under which a landholder is recorded in the revenue register. You can search by it.'],
  ['Is this an official land record?', 'No. LandSetu is a prototype built for a hackathon. Nothing on it is a legal record, and it holds no real land data.'],
  ['How do I check a parcel?', 'Use Search with a ULPIN, an owner name or a khata number. Open the result to see the record from each department and any flags.'],
  ['What does a flag mean?', 'The records from two departments disagree, or a rule was broken. Examples: the owner differs between the Record of Rights and the deed, or a permit exceeds the zoning limit. A flag is a prompt to check. It is not a finding of wrongdoing.'],
  ['The owner on a record is wrong. What do I do?', 'Request a correction with a supporting document, such as a deed number or a mutation order. It goes to the village land officer, then an auditor, then the state administrator.'],
  ['How long does a correction take?', 'Target times are not set for the prototype. Each request shows the stage it is at.'],
  ['Who can change a record?', 'A spelling-level fix to a name or reference needs one approval from an auditor or the state administrator. Any other change needs the village officer, the auditor and the state administrator, in that order. Nobody can approve a request they filed. Every change is written to a tamper-evident audit log.'],
  ['Can a parcel be deleted?', 'No. An approved removal archives the parcel. It leaves the active map, but its record and full history stay on file.'],
  ['Which states are covered?', 'Tamil Nadu (Chennai) and Chandigarh (Sector 17), with sample data. See Coverage.'],
  ['How do I report a problem with this site?', 'Use the Grievance page. Accessibility problems can be reported there too.'],
];

export default function FaqPage() {
  return (
    <PageShell title="Help and frequently asked questions">
      <div className="faq">
        {QA.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </PageShell>
  );
}
