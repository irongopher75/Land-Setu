#!/usr/bin/env node
// Read-only. Prints the Firestore ruleset currently released for a Firebase project, using the account
// signed in to the Firebase CLI (`firebase login`). Release metadata goes to stderr, rules text to stdout.
//
//   node scripts/show_live_firestore_rules.cjs landsetu-e4e5e > /tmp/live.rules
//   diff /tmp/live.rules firestore.rules && echo "live rules match the repo"
//
// Needs a global firebase-tools install (npm i -g firebase-tools). gcloud is not required.
const { execSync } = require('node:child_process');
const path = require('node:path');

const base = path.join(execSync('npm root -g').toString().trim(), 'firebase-tools', 'lib');
const { requireAuth } = require(path.join(base, 'requireAuth'));
const rules = require(path.join(base, 'gcp', 'rules'));
const auth = require(path.join(base, 'auth'));

(async () => {
  const project = process.argv[2];
  if (!project) throw new Error('usage: show_live_firestore_rules.cjs <project-id>');
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error('not signed in: run `firebase login` first');
  await requireAuth({ project, user: account.user, tokens: account.tokens });
  const releases = await rules.listAllReleases(project);
  for (const r of releases.filter((r) => r.name.startsWith(`projects/${project}/releases/cloud.firestore`))) {
    console.error(`release ${r.name} -> ${r.rulesetName} (updated ${r.updateTime})`);
  }
  const name = await rules.getLatestRulesetName(project, 'cloud.firestore', releases);
  if (!name) throw new Error('no Firestore rules release found');
  process.stdout.write((await rules.getRulesetContent(name))[0].content);
})().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
