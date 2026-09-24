import React from 'react';
import OfficerFrame from './OfficerFrame';

export default function EditorPage({ role, isLoggedIn }) {
  return (
    <OfficerFrame title="Parcel editor" path="/officer/editor" role={role} isLoggedIn={isLoggedIn}>
      <p>Boundary edits are made on the parcel map. Every edit becomes a request and passes the village officer, the auditor and the state administrator. Nothing changes on the record until the last approval.</p>
      <table className="data-table">
        <thead><tr><th scope="col">Task</th><th scope="col">How</th></tr></thead>
        <tbody>
          <tr><th scope="row">Add a new boundary</th><td>On the map choose "Mark parcel boundary". Click to place points, drag a point to adjust, then submit.</td></tr>
          <tr><th scope="row">Reshape a parcel</th><td>Open the parcel, choose "Reshape boundary", adjust the points and submit.</td></tr>
          <tr><th scope="row">Split a parcel</th><td>Open the parcel, choose "Split", draw the dividing line across it and submit.</td></tr>
          <tr><th scope="row">Merge two parcels</th><td>Open the first parcel, choose "Merge", click the adjacent parcel and submit.</td></tr>
        </tbody>
      </table>
      <p>The editor checks the drawn shape for overlaps and protected zones before you submit, and shows the area in square metres.</p>
      <p><a className="btn btn--primary" href="#/map">Open the parcel map</a></p>
    </OfficerFrame>
  );
}
