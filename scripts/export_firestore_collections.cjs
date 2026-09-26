#!/usr/bin/env node
// Read-only. Exports whole Firestore collections (every field, plus Firestore's create/update times) from a
// Firebase project to a JSON file, using the account signed in to the Firebase CLI.
//
//   node scripts/export_firestore_collections.cjs landsetu-e4e5e docs/firestore-export-YYYYMMDD.json custom_parcels deleted_parcels
//
// The output path must be gitignored (docs/firestore-export-*.json is): exports can hold personal data.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const base = path.join(execSync('npm root -g').toString().trim(), 'firebase-tools', 'lib');
const { requireAuth } = require(path.join(base, 'requireAuth'));
const auth = require(path.join(base, 'auth'));
const { getAccessToken } = require(path.join(base, 'apiv2'));

// Firestore REST typed value -> plain JSON value.
const plain = (v) => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  return v;
};

(async () => {
  const [project, out, ...collections] = process.argv.slice(2);
  if (!project || !out || !collections.length) throw new Error('usage: <project-id> <out.json> <collection>...');
  if (!execSync(`git check-ignore -q "${out}" && echo ignored || true`).toString().includes('ignored')) {
    throw new Error(`${out} is not gitignored; refusing to write an export that could be committed`);
  }
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error('not signed in: run `firebase login` first');
  await requireAuth({ project, user: account.user, tokens: account.tokens });
  const token = await getAccessToken();

  const result = { project, exported_at: new Date().toISOString(), collections: {} };
  for (const col of collections) {
    const docs = [];
    let pageToken = '';
    do {
      const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${col}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${col}: HTTP ${res.status} ${await res.text()}`);
      const body = await res.json();
      for (const d of body.documents || []) {
        docs.push({
          id: d.name.split('/').pop(),
          name: d.name,
          createTime: d.createTime,
          updateTime: d.updateTime,
          data: plain({ mapValue: { fields: d.fields || {} } }),
          raw_fields: d.fields || {},
        });
      }
      pageToken = body.nextPageToken || '';
    } while (pageToken);
    result.collections[col] = docs;
    console.error(`${col}: ${docs.length} documents`);
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.error(`wrote ${out}`);
})().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
