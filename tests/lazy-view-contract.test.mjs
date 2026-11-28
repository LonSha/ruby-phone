import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_LAZY_ROUTES } from '../config/app-lazy-routes.js';
import { viewText } from '../config/view-text.js';

test('every lazy controller implements the render method called by the host', async () => {
    for (const { id, module, cls } of APP_LAZY_ROUTES) {
        const controller = (await import(new URL('../' + module, import.meta.url)))[cls];
        assert.equal(typeof controller.prototype.render, 'function', id);
    }
});

test('text and quoted attributes preserve literal punctuation', () => {
    assert.equal(viewText(`A&B <C> "D" 'E'`), 'A&amp;B &lt;C&gt; &#34;D&#34; &#39;E&#39;');
});
