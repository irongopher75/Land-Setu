// Firestore security rules tests. Run against the local emulator only:
//   cd tests/firestore-rules && npm ci && npm test
// `npm test` starts the Firestore emulator for the throwaway project "demo-landsetu", so nothing here
// can reach the real Firebase project.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-landsetu',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// Signed-in accounts. The role is a Firebase custom claim, exactly as the records service assigns it.
const as = (uid, role) => env.authenticatedContext(uid, role ? { role } : {}).firestore();
const village = () => as('village-1', 'village_officer');
const village2 = () => as('village-2', 'village_officer');
const auditor = () => as('auditor-1', 'auditor');
const stateAdmin = () => as('admin-1', 'state_admin');
const superAdmin = () => as('super-1', 'super_admin');
const citizen = () => as('citizen-1');

const parcel = { ulpin: 'TN-CHN-0042-9001', state: 'TamilNadu', area_sqm: 452, status: 'active' };

// Put a document in place without rules, to set up a stage of the pipeline.
const seed = (path, data) =>
  env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));

const request = (id, status, requesterUid, extra = {}) => ({
  id, ulpin: 'TN-CHN-0042-9001', status, requesterUid, requestedBy: 'Filed in test', createdAt: '2026-09-26', ...extra,
});

const decide = (db, id, status, role) =>
  updateDoc(doc(db, 'boundary_requests', id), { status, approverRole: role, approvedAt: '2026-09-26' });

describe('custom_parcels: no browser writes a live parcel record', () => {
  test('a village officer cannot create a parcel', async () => {
    await assertFails(setDoc(doc(village(), 'custom_parcels', parcel.ulpin), parcel));
  });

  test('a state administrator cannot create a parcel either', async () => {
    await assertFails(setDoc(doc(stateAdmin(), 'custom_parcels', parcel.ulpin), parcel));
  });

  test('a super administrator cannot create a parcel either', async () => {
    await assertFails(setDoc(doc(superAdmin(), 'custom_parcels', parcel.ulpin), parcel));
  });

  test('no role can update or delete an existing parcel', async () => {
    await seed(`custom_parcels/${parcel.ulpin}`, parcel);
    for (const db of [village(), auditor(), stateAdmin(), superAdmin()]) {
      await assertFails(updateDoc(doc(db, 'custom_parcels', parcel.ulpin), { area_sqm: 99999 }));
      await assertFails(deleteDoc(doc(db, 'custom_parcels', parcel.ulpin)));
    }
  });

  test('signed-in users can read parcels; anonymous visitors cannot', async () => {
    await seed(`custom_parcels/${parcel.ulpin}`, parcel);
    await assertSucceeds(getDoc(doc(citizen(), 'custom_parcels', parcel.ulpin)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'custom_parcels', parcel.ulpin)));
  });
});

describe('deleted_parcels: only a completed deletion request hides a parcel', () => {
  const marker = (requestId) => ({ ulpin: parcel.ulpin, requestId, deletedAt: '2026-09-26' });

  test('a village officer cannot write a deletion marker', async () => {
    await seed('boundary_requests/DEL-1', request('DEL-1', 'DELETED', 'admin-1'));
    await assertFails(setDoc(doc(village(), 'deleted_parcels', parcel.ulpin), marker('DEL-1')));
  });

  test('an auditor cannot write a marker with no request behind it', async () => {
    await assertFails(setDoc(doc(auditor(), 'deleted_parcels', parcel.ulpin), { ulpin: parcel.ulpin, deletedAt: '2026-09-26' }));
    await assertFails(setDoc(doc(auditor(), 'deleted_parcels', parcel.ulpin), marker('does-not-exist')));
  });

  test('an auditor cannot write a marker while the request is still in review', async () => {
    await seed('boundary_requests/DEL-1', request('DEL-1', 'PENDING_DELETION_AUDITOR', 'admin-1'));
    await assertFails(setDoc(doc(auditor(), 'deleted_parcels', parcel.ulpin), marker('DEL-1')));
  });

  test('a completed request for a different parcel does not authorise the marker', async () => {
    await seed('boundary_requests/DEL-1', request('DEL-1', 'DELETED', 'admin-1', { ulpin: 'TN-CHN-0042-1187' }));
    await assertFails(setDoc(doc(auditor(), 'deleted_parcels', parcel.ulpin), marker('DEL-1')));
  });

  test('an auditor can write the marker once the request reached DELETED', async () => {
    await seed('boundary_requests/DEL-1', request('DEL-1', 'DELETED', 'admin-1'));
    await assertSucceeds(setDoc(doc(auditor(), 'deleted_parcels', parcel.ulpin), marker('DEL-1')));
  });

  test('a marker cannot be changed or removed afterwards', async () => {
    await seed(`deleted_parcels/${parcel.ulpin}`, marker('DEL-1'));
    await assertFails(updateDoc(doc(stateAdmin(), 'deleted_parcels', parcel.ulpin), { deletedAt: 'x' }));
    await assertFails(deleteDoc(doc(stateAdmin(), 'deleted_parcels', parcel.ulpin)));
  });
});

describe('boundary_requests: filing', () => {
  test('an officer files at the first stage, as themself', async () => {
    await assertSucceeds(setDoc(doc(village(), 'boundary_requests', 'R1'), request('R1', 'PENDING_VILLAGE_REVIEW', 'village-1')));
  });

  test('a filing cannot start past the first stage or already approved', async () => {
    for (const status of ['PENDING_STATE_ADMIN', 'APPROVED', 'DELETED', 'PENDING_DELETION_AUDITOR']) {
      await assertFails(setDoc(doc(stateAdmin(), 'boundary_requests', 'R1'), request('R1', status, 'admin-1')));
    }
  });

  test('a filing cannot carry a decision', async () => {
    await assertFails(setDoc(doc(village(), 'boundary_requests', 'R1'),
      request('R1', 'PENDING_VILLAGE_REVIEW', 'village-1', { approverRole: 'state_admin' })));
  });

  test('a filing cannot be made in someone else\'s name', async () => {
    await assertFails(setDoc(doc(village(), 'boundary_requests', 'R1'), request('R1', 'PENDING_VILLAGE_REVIEW', 'admin-1')));
  });

  test('a citizen cannot file into the officer pipeline', async () => {
    await assertFails(setDoc(doc(citizen(), 'boundary_requests', 'R1'), request('R1', 'PENDING_VILLAGE_REVIEW', 'citizen-1')));
  });

  test('only a state administrator files a deletion', async () => {
    await assertFails(setDoc(doc(auditor(), 'boundary_requests', 'D1'), request('D1', 'PENDING_DELETION_VILLAGE', 'auditor-1')));
    await assertSucceeds(setDoc(doc(stateAdmin(), 'boundary_requests', 'D1'), request('D1', 'PENDING_DELETION_VILLAGE', 'admin-1')));
  });
});

describe('boundary_requests: only the pipeline moves a request to approved', () => {
  test('full path: village officer, then auditor, then state administrator', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_VILLAGE_REVIEW', 'village-1'));
    await assertSucceeds(decide(village2(), 'R1', 'PENDING_APPROVAL', 'village_officer'));
    await assertSucceeds(decide(auditor(), 'R1', 'PENDING_STATE_ADMIN', 'auditor'));
    await assertSucceeds(decide(stateAdmin(), 'R1', 'APPROVED', 'state_admin'));
  });

  test('a super administrator can finalise', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_STATE_ADMIN', 'village-1'));
    await assertSucceeds(decide(superAdmin(), 'R1', 'APPROVED', 'super_admin'));
  });

  test('nobody below state administrator can finalise', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_STATE_ADMIN', 'village-1'));
    await assertFails(decide(village2(), 'R1', 'APPROVED', 'village_officer'));
    await assertFails(decide(auditor(), 'R1', 'APPROVED', 'auditor'));
  });

  test('no stage can be skipped, even by a state administrator', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_VILLAGE_REVIEW', 'village-1'));
    await assertFails(decide(stateAdmin(), 'R1', 'APPROVED', 'state_admin'));
    await assertFails(decide(stateAdmin(), 'R1', 'PENDING_STATE_ADMIN', 'state_admin'));
    await seed('boundary_requests/R2', request('R2', 'PENDING_APPROVAL', 'village-1'));
    await assertFails(decide(stateAdmin(), 'R2', 'APPROVED', 'state_admin'));
  });

  test('only the current stage\'s reviewer acts', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_VILLAGE_REVIEW', 'village-1'));
    await assertFails(decide(auditor(), 'R1', 'PENDING_APPROVAL', 'auditor'));
    await assertFails(decide(auditor(), 'R1', 'REJECTED', 'auditor'));
    await assertSucceeds(decide(village2(), 'R1', 'REJECTED', 'village_officer'));
  });

  test('nobody decides on a request they filed', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_STATE_ADMIN', 'admin-1'));
    await assertFails(decide(stateAdmin(), 'R1', 'APPROVED', 'state_admin'));
  });

  test('a decision is labelled with the actor\'s real role', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_APPROVAL', 'village-1'));
    await assertFails(decide(auditor(), 'R1', 'PENDING_STATE_ADMIN', 'state_admin'));
  });

  test('a decision cannot also rewrite the request', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_APPROVAL', 'village-1'));
    await assertFails(updateDoc(doc(auditor(), 'boundary_requests', 'R1'),
      { status: 'PENDING_STATE_ADMIN', approverRole: 'auditor', ulpin: 'TN-CHN-0042-1187' }));
    await assertFails(updateDoc(doc(auditor(), 'boundary_requests', 'R1'),
      { status: 'PENDING_STATE_ADMIN', approverRole: 'auditor', area_sqm: 1 }));
  });

  test('a request cannot be edited without a decision', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_APPROVAL', 'village-1'));
    await assertFails(updateDoc(doc(auditor(), 'boundary_requests', 'R1'), { requestedBy: 'Someone else' }));
    await assertFails(decide(auditor(), 'R1', 'PENDING_APPROVAL', 'auditor'));
  });

  test('closed requests accept nothing further', async () => {
    await seed('boundary_requests/R1', request('R1', 'APPROVED', 'village-1'));
    await assertFails(decide(stateAdmin(), 'R1', 'REJECTED', 'state_admin'));
    await assertFails(decide(superAdmin(), 'R1', 'PENDING_STATE_ADMIN', 'super_admin'));
  });

  test('deletion path: village officer, then auditor', async () => {
    await seed('boundary_requests/D1', request('D1', 'PENDING_DELETION_VILLAGE', 'admin-1'));
    await assertFails(decide(auditor(), 'D1', 'DELETED', 'auditor'));
    await assertSucceeds(decide(village(), 'D1', 'PENDING_DELETION_AUDITOR', 'village_officer'));
    await assertFails(decide(stateAdmin(), 'D1', 'DELETED', 'state_admin'));
    await assertSucceeds(decide(auditor(), 'D1', 'DELETED', 'auditor'));
  });

  test('requests are never deleted', async () => {
    await seed('boundary_requests/R1', request('R1', 'PENDING_APPROVAL', 'village-1'));
    await assertFails(deleteDoc(doc(stateAdmin(), 'boundary_requests', 'R1')));
    await assertFails(deleteDoc(doc(superAdmin(), 'boundary_requests', 'R1')));
  });
});

describe('protected_zones: only a state administrator edits notified zones', () => {
  test('a village officer cannot add a zone; a state administrator can', async () => {
    const zone = { id: 'PZ-1', name: 'Test zone' };
    await assertFails(setDoc(doc(village(), 'protected_zones', 'PZ-1'), zone));
    await assertSucceeds(setDoc(doc(stateAdmin(), 'protected_zones', 'PZ-1'), zone));
  });
});

describe('deed_blockchain: no client adds a block', () => {
  const block = {
    ulpin: parcel.ulpin, blockHeight: 3, prevHash: '0xabc', currentHash: '0xdef', createdAt: '2026-09-26',
  };

  test('an officer cannot append a block, whatever its role', async () => {
    for (const db of [village(), auditor(), stateAdmin(), superAdmin()]) {
      await assertFails(setDoc(doc(db, 'deed_blockchain', 'BLK-3'), block));
    }
  });

  test('an existing block cannot be changed or removed', async () => {
    await seed('deed_blockchain/BLK-1', { ...block, blockHeight: 1 });
    await assertFails(updateDoc(doc(stateAdmin(), 'deed_blockchain', 'BLK-1'), { currentHash: '0x000' }));
    await assertFails(deleteDoc(doc(superAdmin(), 'deed_blockchain', 'BLK-1')));
  });
});
