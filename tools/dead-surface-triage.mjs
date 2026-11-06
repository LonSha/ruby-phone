import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const method = JSON.parse(fs.readFileSync(path.join(root, 'scripts/dead-method-baseline.json'), 'utf8'));
const bind = JSON.parse(fs.readFileSync(path.join(root, 'scripts/bind-dead-baseline.json'), 'utf8'));

const methodEntries = method.entries || [];
const groups = {
  neverNew: methodEntries.filter((x) => x.classInstantiated === false),
  instantiated: methodEntries.filter((x) => x.classInstantiated === true),
  unknown: methodEntries.filter((x) => x.classInstantiated == null)
};
const byPath = (items) => Object.entries(items.reduce((m, x) => {
  const top = String(x.rel || x.file || '').split('/')[0] || '(root)';
  m[top] = (m[top] || 0) + 1;
  return m;
}, {})).sort((a, b) => b[1] - a[1]);
const bindGroups = Object.entries((bind.entries || []).reduce((m, x) => {
  m[x.evidence || 'unclassified'] = (m[x.evidence || 'unclassified'] || 0) + 1;
  return m;
}, {}));
const out = {
  generatedAt: new Date().toISOString(),
  method: {
    total: methodEntries.length,
    neverNew: groups.neverNew.length,
    instantiated: groups.instantiated.length,
    unknown: groups.unknown.length,
    pathCounts: byPath(methodEntries),
    neverNewSamples: groups.neverNew.slice(0, 30),
    instantiatedSamples: groups.instantiated.slice(0, 30)
  },
  bindings: {
    total: (bind.entries || []).length,
    evidenceCounts: bindGroups,
    entries: bind.entries || []
  },
  policy: {
    neverNew: 'delete or replace only after confirming no dynamic constructor path; do not add a consumer solely to satisfy the audit',
    instantiated: 'trace the real user workflow; connect through an existing controller/view or delete duplicate behavior',
    nameClash: 'do not add imports; rename local duplicate or remove the redundant export',
    noRef: 'delete if internal-only, otherwise expose through a real product owner and test the workflow'
  }
};
console.log(JSON.stringify(out, null, 2));
