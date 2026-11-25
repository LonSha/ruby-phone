import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatViewSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');
const wechatAppSource = fs.readFileSync(new URL('../apps/wechat/wechat-app.js', import.meta.url), 'utf8');

test('the WeChat input keeps one glass layer instead of nested backdrop filters', () => {
    /* ★ [v4.200.0 修既有] 内联那条 `backdrop-filter: none !important` 挂在**输入区容器**
     *   （`class="chat-input-area"`）上，输入框自己是靠 `apps/wechat/wechat-app.js` 里的
     *   `.wechat-app .chat-input { … backdrop-filter: none; }` 收掉滤镜（下面第三条断言）。
     *   原判据写的是 `class="chat-input"`（少了 `-area`），于是它要求「输入框这个元素自带
     *   `!important` 关闭」—— 那与真实现相反，也永远不会成立。判定面按真元素修正，语义不变：
     *   玻璃层只有一层（容器），输入框不再叠第二层。
     */
    assert.match(chatViewSource, /const inputAreaStyle = [\s\S]{0,220}?backdrop-filter: none !important;/);
    assert.match(chatViewSource, /class="chat-input-area" style="\$\{inputAreaStyle\}"/);
    assert.match(wechatAppSource, /\.wechat-app \.chat-input-area \{[\s\S]*?contain: paint;/);
    assert.match(wechatAppSource, /\.wechat-app \.chat-input \{[\s\S]*?backdrop-filter: none;/);
});

test('animated avatar decorations are isolated in their own paint layer', () => {
    assert.match(wechatAppSource, /\.wechat-app \.message-avatar::after \{[\s\S]*?contain: paint;/);
    assert.match(wechatAppSource, /\.wechat-app \.message-avatar::after \{[\s\S]*?translateZ\(0\)/);
    assert.match(wechatAppSource, /\.wechat-app \.message-avatar::after \{[\s\S]*?backface-visibility: hidden;/);
});
