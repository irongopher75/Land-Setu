import React from 'react';
import PageShell from '../components/PageShell';

export default function NotFoundPage() {
  return (
    <PageShell title="Page not found">
      <p>There is no page at this address. It may have moved, or the link may be wrong.</p>
      <p><a className="btn btn--primary" href="#/">Go to the home page</a> <a className="btn" href="#/search">Search a parcel</a></p>
    </PageShell>
  );
}
