// A write to the shared Firestore copy failed after the records service had already accepted the action.
// The action stands, but the user is told the shared copy was not updated. App.jsx shows this as a banner.
export const SYNC_NOTICE_EVENT = 'landsetu-sync-notice';

export const notifySyncIssue = (action, reason) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_NOTICE_EVENT, { detail: { action, reason } }));
};

// Plain-language reason for a refused or failed Firestore write.
export const describeFirestoreError = (err) => {
  if (err?.code === 'permission-denied') {
    return 'The shared record store refused it: your role, or the request\'s current stage, does not allow this change.';
  }
  if (err?.code === 'not-found') return 'The shared record store has no copy of this request.';
  if (err?.code === 'unavailable') return 'The shared record store could not be reached.';
  if (!err) return 'The shared record store is not configured in this build.';
  return err.message || 'The shared record store returned an error.';
};
