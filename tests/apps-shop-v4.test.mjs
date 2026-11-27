import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ShopView, SHP_FACES } from '../apps/shop/shop-view.js';

const css = readFileSync(new URL('../apps/shop/shop.v4.css', import.meta.url), 'utf8');
test('shop: layered styles, navigation stays in flow', () => {
  assert.ok(css.includes('@layer rp.apps'));
  assert.ok(css.includes('min-height: 44px'));
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /position\s*:\s*fixed|!important/);
});
test('shop: each page keeps its action key and marks exactly one current button', () => {
  const view = Object.create(ShopView.prototype);
  view.app = { tab: () => view.tab };
  view._proj = () => ({}); view._list = () => [];
  for (const fn of ['_cartHTML', '_storeHTML', '_settingsHTML', '_ordersHTML']) view[fn] = () => '';
  const keys = SHP_FACES.map(t => t.key);
  assert.ok(keys.length > 1);
  for (const active of keys) {
    view.tab = active;
    const html = view._buildHTML();
    const nav = html.slice(html.indexOf('role="navigation"'));
    assert.ok(nav.includes('aria-label="主导航"'));
    const buttons = [...nav.matchAll(/<button\b([^>]*)>/g)].map(m => m[1]);
    assert.equal(buttons.length, keys.length);
    buttons.forEach((attrs, i) => {
      assert.ok(attrs.includes(` data-tab="${keys[i]}"`));
      assert.ok(attrs.includes(` data-shp-face="${keys[i]}"`));
      assert.ok(!attrs.includes('""'));
      assert.equal(attrs.includes(' aria-current="page"'), keys[i] === active);
    });
  }
});
