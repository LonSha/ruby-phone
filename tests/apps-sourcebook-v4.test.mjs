import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SBR_FACES, SourcebookView } from '../apps/sourcebook/sourcebook-view.js';

test('sourcebook: every page preserves its action and exactly one current button', () => {
  const keys = SBR_FACES.map(t => t.key);
  assert.equal(keys.length, 5);
  for (const key of keys) {
    const v = Object.create(SourcebookView.prototype);
    v.app = { tab: () => key };
    const html = v._tabsHTML();
    assert.ok(html.startsWith('<nav class="sbr-tabs" aria-label="时光胶囊主导航">'));
    const buttons = [...html.matchAll(/<button\b([^>]*)>/g)];
    assert.equal(buttons.length, keys.length);
    buttons.forEach(([,attrs], i) => {
      assert.ok(attrs.includes(` data-tab="${keys[i]}" data-sbr-face="${keys[i]}"`));
      assert.equal(attrs.includes(' aria-current="page"'), key === keys[i]);
    });
  }
});
test('sourcebook: lazy stylesheet delivers layered touch targets', () => {
  const read = name => readFileSync(new URL(`../apps/sourcebook/${name}`, import.meta.url), 'utf8');
  assert.ok(read('sourcebook.css').includes('@import url("./sourcebook.v4.css")'));
  assert.ok(read('sourcebook.v4.css').includes('min-height: 44px'));
});
