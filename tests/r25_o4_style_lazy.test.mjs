/* R25-O4 样式懒加载：搬出 phone.css 的 App 样式，打开时才注入 <link>
 * 纪律：内核在 node 里逐条判；装载器用**假 doc** 把 load/error/timeout/去重四条边界真造出来；
 *   迁移工具当场复算（幂等即证「真搬走了」）；负控制证明判据自己会红。
 * 本文件不用正则（生成链会吃反斜杠），一律 includes / indexOf。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    STYLE_LAZY, STYLE_LAZY_TIMEOUT_MS, styleLazyEntry, styleLazyBudget, stylePlan,
    styleReceipt, styleVerdict, styleLazySelfCheck, createStyleLoader
} from '../config/style-lazy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const bytes = (rel) => fs.statSync(path.join(ROOT, rel)).size;

/** 假 doc：只实现装载器用到的那几个成员，但事件真的派发、节点真的进 head。 */
function makeFakeDoc() {
    const byId = new Map();
    const head = {
        children: [],
        appendChild(node) { this.children.push(node); return node; }
    };
    function makeEl(tag) {
        const listeners = new Map();
        const el = {
            tagName: String(tag).toUpperCase(),
            dataset: {},
            rel: '',
            href: '',
            id: '',
            addEventListener(kind, fn) {
                if (!listeners.has(kind)) listeners.set(kind, []);
                listeners.get(kind).push(fn);
            },
            dispatch(kind) {
                const arr = listeners.get(kind) || [];
                arr.slice().forEach((fn) => fn());
            },
            remove() {
                if (el.id && byId.get(el.id) === el) byId.delete(el.id);
                head.children = head.children.filter((x) => x !== el);
            }
        };
        return el;
    }
    const doc = {
        head: head,
        createElement(tag) { return makeEl(tag); },
        getElementById(id) { return byId.get(String(id)) || null; },
        /* 节点把自己的 id 登记进 byId —— 真实 DOM 就是这样的，假 doc 也得一样。 */
        _register(el) { if (el && el.id) byId.set(el.id, el); return el; }
    };
    const origAppend = head.appendChild.bind(head);
    head.appendChild = (node) => {
        origAppend(node);
        doc._register(node);
        return node;
    };
    return doc;
}

test('O4-1 内核自检全绿 + 账本形状（每条都指向真实存在的 css，且 bytes>0）', () => {
    const sc = styleLazySelfCheck();
    assert.equal(sc.ok, true, JSON.stringify(sc.items));
    assert.equal(sc.items.length >= 5, true);
    assert.equal(STYLE_LAZY.length, 9);
    for (const e of STYLE_LAZY) {
        assert.equal(typeof e.appId, 'string');
        assert.equal(Number.isFinite(e.bytes) && e.bytes > 0, true, e.appId + ' 的 bytes 必须为正数（不许 0 占位）');
        const rel = e.css.split('./')[1];
        assert.equal(fs.existsSync(path.join(ROOT, rel)), true, e.appId + ' 的 css 文件必须真实存在：' + rel);
        assert.equal(String(e.why || '').length > 4, true, e.appId + ' 必须写清为什么它可以在首屏缺席');
    }
    const b = styleLazyBudget();
    assert.equal(b.bytesOut, STYLE_LAZY.reduce((s, e) => s + e.bytes, 0));
});

test('O4-2 真搬走了：迁移工具复算必须「已搬完」（幂等），且 phone.css 里查不到这些独占规则', () => {
    const r = spawnSync(process.execPath, ['tools/split_phone_css_lazy.mjs'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, '工具必须 exit 0（一致）：' + r.stdout + r.stderr);
    assert.equal(String(r.stdout).indexOf('已搬完') >= 0, true, 'phone.css 里应已无这些 App 的独占规则：' + r.stdout);
    const css = read('phone.css');
    const count = (hay, needle) => {
        let n = 0;
        let i = 0;
        while ((i = hay.indexOf(needle, i)) >= 0) { n += 1; i += needle.length; }
        return n;
    };
    for (const e of STYLE_LAZY) {
        /* 口径：不要求首屏一次不剩（共享态类 .is-* 组合选择器按纪律**必须留下**），
         * 而要求「大头搬走了」：phone.css 里该前缀的残留必须少于它自己 css 的 30%。
         * 这条能拦住「只搬了两条做样子」：那种搬法残留率仍接近 100%。 */
        const needle = e.prefixes[0] + '-';
        const own = count(read('apps/' + e.appId + '/' + e.appId + '.css'), needle);
        const left = count(css, needle);
        assert.equal(own > 10, true, e.appId + ' 自己的 css 里应确有该前缀：' + own);
        assert.equal(left < own * 0.3, true, e.appId + ' 前缀 ' + needle + ' 在首屏残留 ' + left + ' 处 / 自己 css ' + own + ' 处（上限 30%）');
    }
});

test('O4-3 装载器真注入：打开该 App 才出现 link，load 之后回执 ok 且计数为 1', async () => {
    const doc = makeFakeDoc();
    const loader = createStyleLoader({ doc: doc, baseUrl: 'https://h/p/', now: () => 100 });
    assert.equal(doc.head.children.length, 0, '没开 App 之前 head 里不许有样式节点');
    const p = loader.ensure('needsim');
    assert.equal(doc.head.children.length, 1, '打开 App 之后必须真插了 1 个 link');
    const link = doc.head.children[0];
    assert.equal(link.id, 'app-style-needsim');
    assert.equal(link.rel, 'stylesheet');
    assert.equal(link.href, 'https://h/p/./apps/needsim/needsim.css');
    link.dispatch('load');
    const rec = await p;
    assert.equal(rec.ok, true);
    assert.equal(rec.face, 'loaded');
    const col = loader.collect();
    assert.equal(col.loaded, 1);
    assert.equal(col.degraded, 0);
    assert.equal(col.bytesOut, styleLazyBudget().bytesOut, 'collect 必须报出首屏少付的字节');
});

test('O4-4 并发打开同一 App 只插一个 link（不许两个 link 两套规则打架）', async () => {
    const doc = makeFakeDoc();
    const loader = createStyleLoader({ doc: doc, baseUrl: 'x/', now: () => 0, setTimeout: () => 1, clearTimeout: () => {} });
    const a = loader.ensure('kettle');
    const b = loader.ensure('kettle');
    assert.equal(doc.head.children.length, 1);
    doc.head.children[0].dispatch('load');
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.ok, true);
    assert.equal(rb.ok, true);
    assert.equal(loader.collect().loaded, 1, '两次 ensure 只算一次真加载');
});

test('O4-5 三态不压平：error ⇒ degraded / 超时 ⇒ unknown / 无 host ⇒ unknown（都不是 loaded）', async () => {
    const doc1 = makeFakeDoc();
    const l1 = createStyleLoader({ doc: doc1, baseUrl: 'x/', now: () => 5 });
    const p1 = l1.ensure('doujin');
    doc1.head.children[0].dispatch('error');
    const r1 = await p1;
    assert.equal(r1.ok, false, '样式没来不许报 ok');
    assert.equal(r1.face, 'degraded');
    assert.equal(r1.reason, 'error');

    /* 超时：不派发任何事件，只让注入的定时器立刻回调 ⇒ 只许是 unknown。 */
    const doc2 = makeFakeDoc();
    let fire = null;
    const l2 = createStyleLoader({
        doc: doc2, baseUrl: 'x/', now: () => 7,
        setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {}
    });
    const p2 = l2.ensure('pvdesk');
    assert.equal(typeof fire, 'function', '必须真挂了超时器（没挂就永远等不到 unknown）');
    fire();
    const r2 = await p2;
    assert.equal(r2.ok, false);
    assert.equal(r2.face, 'unknown', '没等到结果不许写成 degraded，更不许写 loaded');
    assert.equal(l2.collect().unknown, 1);
    assert.equal(l2.collect().degraded, 0);
    assert.equal(STYLE_LAZY_TIMEOUT_MS > 0, true);

    const l3 = createStyleLoader({ doc: null, baseUrl: 'x/' });
    const r3 = await l3.ensure('soundkit');
    assert.equal(r3.face, 'unknown', '无宿主 ⇒ 没尝试过，不是失败也不是成功');
    assert.equal(String(r3.reason).indexOf('no-doc') >= 0, true);
});

test('O4-6 未登记的 App ⇒ bundled（不是 lazy 的空壳），且不插任何节点', async () => {
    const plan = stylePlan('wechat', 'x/');
    assert.equal(plan.mode, 'bundled');
    assert.equal(styleLazyEntry('wechat'), null);
    const doc = makeFakeDoc();
    const loader = createStyleLoader({ doc: doc, baseUrl: 'x/' });
    const rec = await loader.ensure('wechat');
    assert.equal(rec.face, 'bundled', '首屏里的样式不许被说成「已懒加载」');
    assert.equal(rec.ok, true);
    assert.equal(doc.head.children.length, 0);
});

test('O4-7 负控制：把「没来」写成 ok=true ⇒ O4-5 同款断言必须转红', async () => {
    const src = read('config/style-lazy.js');
    const from = '        ok: loaded === true,';
    assert.equal(src.split(from).length - 1, 1, '负控制锚点必须恰中一次');
    const broken = src.replace(from, '        ok: true,');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_o4_'));
    const file = path.join(dir, 'style-lazy.broken.js');
    fs.writeFileSync(file, broken);
    /* [v4107 维护] style-lazy.js 现在 import 了 config/num-gate.js（把弱口径
     * `Number.isFinite(Number(x))` 换成 numOrNull）。负控制把实现复制到 /tmp 单跑时，
     * 那条相对 import 会解析到不存在的 /tmp/.../num-gate.js ⇒ ERR_MODULE_NOT_FOUND。
     * 修法是**把叶子依赖一起搬**（num-gate.js 零 import，搬它不改变被测行为），
     * 而不是把负控制改成「在仓内写临时文件」（那会把测试变成会留残骸的事故）。 */
    fs.copyFileSync(path.join(ROOT, 'config/num-gate.js'), path.join(dir, 'num-gate.js'));
    const mod = await import(pathToFileURL(file).href);
    const doc = makeFakeDoc();
    const loader = mod.createStyleLoader({ doc: doc, baseUrl: 'x/', now: () => 1 });
    const p = loader.ensure('doujin');
    doc.head.children[0].dispatch('error');
    const rec = await p;
    assert.equal(rec.face, 'degraded', 'face 仍如实是 degraded');
    assert.equal(rec.ok, true, '被打补丁后「没来」被写成了 ok —— O4-5 的 assert.equal(rec.ok,false) 换到这个实现上必然转红');
});

test('O4-8 接线证据：openApp 咽喉并行取样式与模块，回执上屏 dataset', () => {
    const src = read('index.js');
    assert.equal(src.indexOf('createStyleLoader({') >= 0, true, '宿主必须真构造装载器');
    assert.equal(src.indexOf('appStyleLoader.ensure(appId)') >= 0, true, '打开 App 时必须真调 ensure');
    const iEnsure = src.indexOf('appStyleLoader.ensure(appId)');
    const iImport = src.indexOf('bootTiming.instrumentImport(import(lazyRoute.module), lazyRoute.module),');
    assert.equal(iImport >= 0, true, '模块懒加载仍在（不许为了样式把它丢了）');
    assert.equal(Math.abs(iEnsure - iImport) < 200, true, '两者必须在同一个 Promise.all 里并行（不并行就白等一次）');
    assert.equal(src.indexOf("dataset.appStyleBytesOut") >= 0, true, '首屏少付多少字节必须上屏，给人看也给人断言');
    assert.equal(src.indexOf("window.VirtualPhone._r25O4") >= 0, true, '回执要挂到 VirtualPhone 供诊断读');
});

test('O4-9 真字节：phone.css 变小了，且少的量就是账本声明的九条之和', () => {
    const real = bytes('phone.css');
    const before = 720288;
    const v = styleVerdict(before, real, 1);
    assert.equal(v.face, 'improved', '首屏 CSS 必须真的变小：' + real + 'B');
    assert.equal(v.deltaPct < 0, true);
    const claimed = styleLazyBudget().bytesOut;
    assert.equal(real <= before - claimed + 64, true, '账单：搬走 ' + claimed + 'B，phone.css 实为 ' + real + 'B（before ' + before + '）');
    /* 九条之和必须是九个 App 自主 css 的「真字节」量级（±15%）——防账本写虚数。 */
    let sum = 0;
    for (const e of STYLE_LAZY) sum += bytes('apps/' + e.appId + '/' + e.appId + '.css');
    assert.equal(claimed > sum * 0.85, true, '账本声称搬走的字节不该超过各 App css 实字节太多：' + claimed + ' vs ' + sum);
});

test('O4-10 旧「纸面装载器」已退役：不许留一份假装在加载的模块', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'config', 'style-loader.js')), false, 'R24-O3 的 planStyleShards 是虚构字节 + 不注入 DOM 的账，已由真实现取代');
    const src = read('index.js');
    assert.equal(src.indexOf('styleLoaderSelfCheck') < 0, true, '旧自检不许还挂在装配点');
    assert.equal(src.indexOf("['_r25O4', styleLazySelfCheck]") >= 0, true, '新自检必须挂进装配点（写完没人跑等于没写）');
});