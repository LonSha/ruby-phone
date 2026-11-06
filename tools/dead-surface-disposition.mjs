import fs from 'node:fs';

const method = JSON.parse(fs.readFileSync('scripts/dead-method-baseline.json', 'utf8'));
const bind = JSON.parse(fs.readFileSync('scripts/bind-dead-baseline.json', 'utf8'));
const disposition = {
  schema: 'dead-surface-disposition@1',
  generatedAt: new Date().toISOString(),
  rule: 'Disposition is evidence, not a green-light override. Product consumption must be real code; test-only references do not count.',
  methods: method.entries.map((entry) => ({
    ...entry,
    disposition: entry.classInstantiated === false ? 'candidate-for-removal-or-real-product-owner' : 'requires-workflow-trace-before-change',
    reason: entry.classInstantiated === false
      ? 'class is not instantiated in the static production constructor index; verify dynamic host construction before deletion'
      : 'class is instantiated, but this method has no production call site; connect to a real workflow or remove duplicate behavior'
  })),
  bindings: bind.entries.map((entry) => ({
    ...entry,
    disposition: entry.evidence === 'name-clash' ? 'rename-or-remove-duplicate' : 'verify-external-contract-or-remove',
    reason: entry.evidence === 'name-clash'
      ? 'same-name references are not imports from this module'
      : 'no production reference was found by the binding audit'
  }))
};
process.stdout.write(JSON.stringify(disposition, null, 2) + '\n');