import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settingsCss = fs.readFileSync(new URL('../apps/settings/settings.v3.css', import.meta.url), 'utf8');
const skinRuntime = fs.readFileSync(new URL('../phone/ui/rp-skin-runtime.js', import.meta.url), 'utf8');

/* iOS 27 设置 UI 重构的可证判据。
   依据：Apple 2026-09-14 发布公告（Liquid Glass 重做、可调透明度）、HIG Materials（Liquid Glass
   只用于功能层，内容层用标准材质）、HIG Scroll Views（2026-06-08：优先用自动滚动边缘样式，
   为包含大量控件的顶部工具栏提供更不透明的视觉分隔）。 */

test('A1 导航栏去掉自定义实底，改用 Liquid Glass 常规变体', () => {
    assert.doesNotMatch(
        settingsCss,
        /settings-app-header[^{]*\{[^}]*--lt-sys-grouped-bg[^}]*-webkit-backdrop-filter:\s*none/
    );
    assert.match(settingsCss, /settings-app-header[\s\S]{0,200}?background:\s*var\(--lt-glass-fill\)/);
    assert.match(settingsCss, /settings-app-header[\s\S]{0,200}?backdrop-filter:\s*var\(--lt-glass-blur\)/);
});

test('A2 标签栏同样去掉 iOS 26 之前的手写玻璃实底', () => {
    assert.doesNotMatch(settingsCss, /settings-tabs[\s\S]{0,300}?rgba\(247,\s*247,\s*247/);
    assert.match(settingsCss, /settings-tabs[\s\S]{0,200}?background:\s*var\(--lt-glass-fill-strong\)/);
});

test('B1 iOS 27 新增的玻璃加深边缘：栏取 --lt-glass-rim 而非单色描边', () => {
    assert.match(settingsCss, /settings-app-header, \.yzp-settings-header\)\s*\{\s*box-shadow:\s*var\(--lt-glass-rim\)/);
});

test('B2 镜面高光固定在栏顶，不随滚动移动', () => {
    assert.match(settingsCss, /settings-app-header, \.yzp-settings-header\)::after\s*\{[^}]*background:\s*var\(--lt-glass-specular\)/);
    assert.doesNotMatch(settingsCss, /settings-app-header[\s\S]{0,400}?@keyframes/);
});

test('C1 滚动边缘分隔挂在标签栏下沿，默认隐藏', () => {
    assert.match(settingsCss, /settings-tabs\)::after\s*\{[^}]*background:\s*var\(--lt-sys-separator\)/);
    assert.match(settingsCss, /settings-tabs\)::after\s*\{[^}]*opacity:\s*0/);
});

test('C2 滚动边缘只在根节点带 data-rp27-scrolled 时出现', () => {
    assert.match(settingsCss, /data-rp-ios="3"\]\[data-rp27-scrolled\][^{]*settings-tabs\)::after\s*\{[^}]*opacity:\s*1/);
});

test('D1 皮肤运行时新增 edge 步骤，默认开启、可单独关', () => {
    assert.match(skinRuntime, /edge:\s*opts\.edge !== false/);
});

test('D2 edge 步骤接进 run()，还原接进 detach()', () => {
    assert.match(skinRuntime, /try \{ edgeTree\(scope\); \} catch/);
    assert.match(skinRuntime, /unedge\(\);/);
});

test('D3 edge 只挂滚动容器、只写一个属性，运行时零颜色零 important', () => {
    assert.match(skinRuntime, /const EDGE_SEL = '\.app-body';/);
    assert.match(skinRuntime, /setAttribute\('data-rp27-scrolled', '1'\)/);
    assert.match(skinRuntime, /removeAttribute\('data-rp27-scrolled'\)/);
    // 只取实现块（从 edgeScroll 声明到 run()），不碰文件头注释里的同名字样
    const impl = skinRuntime.slice(skinRuntime.indexOf('const edgeScroll'), skinRuntime.indexOf('function run(scope)'));
    assert.match(impl, /function edgeSync/);
    assert.match(impl, /function edgeTree/);
    assert.match(impl, /function unedge/);
    assert.doesNotMatch(impl, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(impl, /!important/);
});

test('E1 分层不变：Liquid Glass 只进功能层，内容层分组卡仍用标准材质', () => {
    assert.match(settingsCss, /\.setting-section \{[^}]*background:\s*var\(--lt-sys-grouped-bg-2\)/);
    assert.doesNotMatch(settingsCss, /\.setting-section \{[^}]*(--lt-glass-fill|--lt-glass-blur)/);
});

test('E2 本文件规矩未破：零 !important、零写死颜色', () => {
    // 逐行跟踪注释块状态：只看真正的代码行（跨行注释中间的行不以 * 或 /* 开头，糙过滤会漏）
    let inBlock = false;
    const codeLines = [];
    for (const raw of settingsCss.split('\n')) {
        const t = raw;
        if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
        if (t.trim().startsWith('/*')) { if (!t.slice(2).includes('*/')) inBlock = true; continue; }
        codeLines.push(t);
    }
    assert.equal(codeLines.filter((l) => /!important/.test(l)).length, 0, '出现 !important');
    assert.equal(codeLines.filter((l) => /#[0-9a-fA-F]{3,8}\b/.test(l)).length, 0, '出现写死颜色');
});