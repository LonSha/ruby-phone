import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Real source + gate + baselines, copied without hardlinks. No --root/fixture bypass.
 * Mutants never touch the working tree, so concurrent readers need no locks.
 * Keep tests too: some gate libraries intentionally examine their import edges.
 */
export function withAuditCopy(root, fn) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-audit-copy-'));
  const skip = new Set(['.git', 'node_modules', '.wrangler', 'dist']);
  function walk(dir, dest) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || skip.has(ent.name)) continue;
      const src = path.join(dir, ent.name);
      const dst = path.join(dest, ent.name);
      if (ent.isDirectory()) walk(src, dst);
      else if (ent.isFile() && /\.(?:js|mjs|json)$/.test(ent.name)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
  }
  try {
    walk(root, copy);
    return fn(copy);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

/** Async counterpart: keeps the real-source mutant copy alive until an async audit finishes. */
export async function withAuditCopyAsync(root, fn) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-audit-copy-'));
  const skip = new Set(['.git', 'node_modules', '.wrangler', 'dist']);
  function walk(dir, dest) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || skip.has(ent.name)) continue;
      const src = path.join(dir, ent.name);
      const dst = path.join(dest, ent.name);
      if (ent.isDirectory()) walk(src, dst);
      else if (ent.isFile() && /\.(?:js|mjs|json)$/.test(ent.name)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
  }
  try {
    walk(root, copy);
    return await fn(copy);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}
