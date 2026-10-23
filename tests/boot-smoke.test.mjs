/* ============================================================
 * tests/boot-smoke.test.mjs — 启动链运行时冒烟门 [v4.54.1]
 * ------------------------------------------------------------
 * 为什么需要（v4.54.1 事故复盘）：
 *   v4.45.0 把 boardChatTake 三函数插进了 applyCreationdeskAction 的函数体中间，
 *   init() 抛 ReferenceError 被 try/catch 吞掉 ⇒ injectWhenReady 不跑 ⇒
 *   悬浮球 / 魔法棒入口 / 面板 / 三击唤醒全部不挂载。而既有门禁全绿：
 *     · 语法门（ESM parse）只证「能解析」，作用域错位照样解析通过；
 *     · 文本断言（code.indexOf('function boardChatTake') >= 0）插哪都绿。
 *   ⇒ 「装进酒馆里没有面板」这类 P0 只能靠**真加载一次入口**来拦。
 *
 * 本测试做什么：零依赖最小宿主桩（与 tests/_runtime_host.mjs 同思路但更小：
 *   只要够 index.js 走到 init 的 injectWhenReady），真 import 本仓 index.js，
 *   断言 UI 出口真的挂上了。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── 判据纯度（本仓 H5/H6 纪律）：先证「判据能翻红」——用被破坏的副本跑一次，
 *    破坏必须可观测；再在真仓库上跑同一判据。破坏锚点只声明一次。 ── */
const ANCHOR = 'motion: motionRuntime,';

import { copyTreeSafe } from './_mirror_tree.mjs';

/** 造副本树（跳过 .git 与大目录；本测试只需要可运行的模块树）。
 *  ★ 必须走 tests/_mirror_tree.mjs 的共享实现（v3.23.0 上收口径）：
 *    tests/ 下不得出现裸 fs.cpSync —— 那正是 v3230 A1 守的纪律。
 *    （v4.54.1 首版这里裸调了 cpSync，当场被 v3230 判红，改成 copyTreeSafe。） */
function makeTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_boot_'));
    copyTreeSafe(root, path.join(dir, 'rp'), {
        filter: (src) => {
            const rel = path.relative(root, src);
            return !(rel === '.git' || rel === 'dist' || rel === 'node_modules' || rel === '.github' || rel === 'tools');
        },
    });
    return path.join(dir, 'rp');
}

/* 上面注释里自证过的顾虑：整包 IIFE 会连坐顶层 return。
 * ⇒ 最终破坏形态改为「把装配点吞进一个死函数」：
 *   `function __dead(){ window.VirtualPhone = { ... } }` 之后的代码不变，
 *   会多出一个未闭合大括号 —— 语法门会红，达不到「语法绿但运行时死」。
 * ⇒ 采用与真实事故同形的破坏：把三个 VirtualPhone 出口键改名为不存在的作用域名，
 *   即 init() 抛 ReferenceError 的原始形态。 */
function breakLikeV4450(rp) {
    const ip = path.join(rp, 'index.js');
    let s = fs.readFileSync(ip, 'utf8');
    // 与 v4.45.0 同形的破坏：装配点引用一个**不存在的标识符**（boardChatTake 原样）。
    // 展开属性（...previous）在首键之后 ⇒ 首键求值即抛 ReferenceError，
    // init() 的 catch 吞掉 ⇒ injectWhenReady 不跑 ⇒ 装配点永不完成。
    // 注意不能用 `...(x ? {} : throw)`：展开元素位置没有 throw 表达式，只能取值。
    s = s.replace(ANCHOR, 'motion: __undefinedInThisScope_Broken,');
    fs.writeFileSync(ip, s, 'utf8');
}

async function bootOnce(repoDir, { expectMounted }) {
    // 动态加载 jsdom 不行（零依赖仓）⇒ 用 Node 内置能力 + 手写桩。
    // index.js 只用到 window/document/localStorage/SillyTavern/$/fetch/performance/…，
    // 全部可用轻桩顶住；断言面是 VirtualPhone 装配 + 注入循环挂载，不依赖真实 DOM 树。
    const prev = {};
    const g = globalThis;
    const take = (k) => { prev[k] = g[k]; };
    const give = (k, v) => { take(k); g[k] = v; };

    const listeners = [];
    const intervals = [];
    const fakeDoc = {
        hidden: false, visibilityState: 'visible',
        head: stubEl('head'), body: stubEl('body'),
        documentElement: stubEl('html'),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => stubEl('element'),
        createElementNS: () => stubEl('element'),
        createTextNode: (t) => ({ nodeValue: t }),
        createDocumentFragment: () => stubEl('fragment'),
        addEventListener: (t, h) => listeners.push(['document', t, h]),
        removeEventListener: () => {},
    };
    const fakeWin = {
        innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        addEventListener: (t, h) => listeners.push(['window', t, h]),
        removeEventListener: () => {},
        dispatchEvent: () => true,
        localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(String(k), String(v)); }, removeItem(k) { this._m.delete(k); }, key(i) { return [...this._m.keys()][i] ?? null; }, get length() { return this._m.size; }, clear() { this._m.clear(); } },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) }),
        CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
        Event: class { constructor(t) { this.type = t; } },
        MutationObserver: class { observe() {} disconnect() {} },
        requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        location: { href: 'file://' + repoDir + '/index.js', protocol: 'file:' },
        navigator: { userAgent: 'smoke' },
    };
    const eventSource = {
        on() { return this; }, once() { return this; }, removeListener() { return this; }, emit() {},
    };
    const ctx = {
        chat: [{ mes: 'hi', is_user: false, swipes: ['hi'], swipe_id: 0 }],
        chatMetadata: {}, chatId: 'smoke', name1: 'user', name2: 'char',
        characters: [], eventSource,
        event_types: {
            MESSAGE_RECEIVED: 'message_received', USER_MESSAGE_RENDERED: 'user_message_rendered',
            CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', MESSAGE_DELETED: 'message_deleted',
            MESSAGE_SWIPED: 'message_swiped', CHAT_CHANGED: 'chat_changed',
            GENERATION_STARTED: 'generation_started',
            GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
            CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
        },
        extensionSettings: { st_virtual_phone: {} },
        saveChat: async () => {}, saveSettingsDebounced: () => {}, saveMetadata: async () => {},
        SlashCommandParser: { addCommandObject() {} },
        SlashCommand: { fromProps: (o) => o },
    };
    const stObj = { getContext: () => ctx };

    function stubEl(name) {
        const el = {
            __stub: name, children: [], style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            setAttribute() {}, getAttribute: () => null, appendChild(c) { el.children.push(c); return c; },
            insertAdjacentHTML() {}, addEventListener() {}, removeEventListener() {}, remove() {},
            querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
            innerHTML: '', textContent: '', value: '',
            getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
        };
        return el;
    }

    // 常驻 interval 必须 unref + finally 清理：
    //   入口的 globalRuntime 轮询 / 调度器会一直滴答，把 node --test 的事件循环挂住。
    //   v4.54.1 首版对此的处置是 bootOnce 末尾 `process.exit(code)` —— 那会让**同文件后面的
    //   H2/H3 根本不执行**（日志里 `ℹ tests 1`，负控制从未跑过，等于判据自我豁免）。
    //   正确形态：给桩 setInterval 一律 unref，让事件循环自然排空，绝不提前杀进程。
    const realSetInterval = g.setInterval;
    const realClearInterval = g.clearInterval;
    give('setInterval', (fn, ms, ...args) => {
        const id = realSetInterval(fn, ms, ...args);
        try { id.unref?.(); } catch { /* 非 Node Timeout 句柄则忽略 */ }
        intervals.push(id);
        return id;
    });
    give('clearInterval', (id) => realClearInterval(id));
    // 全局 fetch 桩：phone.css 动态注入走的是全局 fetch（不是 window.fetch），
    // 缺它会打「❌ phone.css 动态注入失败: fetch failed」噪声，掩盖真正的失败信号。
    give('fetch', fakeWin.fetch);

    give('window', fakeWin); give('document', fakeDoc);
    give('localStorage', fakeWin.localStorage); give('sessionStorage', fakeWin.sessionStorage);
    give('CustomEvent', fakeWin.CustomEvent); give('Event', fakeWin.Event);
    give('MutationObserver', fakeWin.MutationObserver);
    give('getComputedStyle', fakeWin.getComputedStyle);
    give('requestAnimationFrame', fakeWin.requestAnimationFrame);
    give('cancelAnimationFrame', fakeWin.cancelAnimationFrame);
    give('SillyTavern', stObj);
    // $ 必须给最小桩：init() 第一道门就是 `typeof $ === 'undefined'` 重试等待（500ms 轮询）。
    // （v4.54.1 冒烟门第一次跑就栽在这：桩漏了 $，init 永远在等 jQuery，冒烟 40 秒都不装配。）
    const noopJQ = () => { const api = { each() { return api; }, find() { return api; }, hide() { return api; }, appendTo() { return api; }, closest() { return api; }, on() { return api; }, length: 0 }; return api; };
    noopJQ.fn = {}; noopJQ.ready = (fn) => { try { fn(); } catch { } return noopJQ; };
    give('$', noopJQ);
    // navigator 在 Node 21+ 是只读 getter，走 defineProperty；失败则保留原值（桩已足够）
    try { take('navigator'); Object.defineProperty(g, 'navigator', { value: { userAgent: 'smoke' }, configurable: true }); } catch { /* 保持原值 */ }

    const errors = [];
    const onErr = (r) => errors.push(String((r && r.message) || r));
    const unhandled = (r) => onErr(r);
    process.on('unhandledRejection', unhandled);

    let result = { mounted: false, version: null, threw: null };
    try {
        // 与酒馆同形态：ESM 动态 import 真入口。相对 import 由 ESM 解析器按文件路径解析。
        const entryUrl = 'file://' + path.join(repoDir, 'index.js');
        // index.js 求值即开始 init()（异步）， import 返回后给它几个事件循环
        await import(entryUrl);
        for (let i = 0; i < 40 && !result.mounted; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const vp = fakeWin.VirtualPhone;
            // init 的 catch 吞错面（v4.45.0 事故形态）必须**先判**：装配抛错会被 catch 静默，
            // 唯一信号是 [v4.54.1] 故障可见性出口 window.__phoneBootFailed。
            if (fakeWin.__phoneBootFailed) {
                result.threw = 'init-catch: ' + fakeWin.__phoneBootFailed.message;
                break;
            }
            // 装配完成的可观测面：主装配区跑完（bootTiming 出口在场 = 装配区至少执行到中段）；
            // version 由 init().then() 在 init 成功返回后写上，是最强的完成信号。
            if (vp && vp.version) result = { mounted: true, version: vp.version, threw: errors[0] || null };
            else if (vp && vp.bootTiming) result = { mounted: true, version: vp.version || '', threw: errors[0] || null };
        }
        if (!result.mounted && !result.threw && errors.length) result.threw = errors[0];
    } catch (e) {
        result.threw = String((e && e.message) || e);
    } finally {
        process.off('unhandledRejection', unhandled);
        // 拆全局（防 node --test 事件循环被入口的常驻 interval 挂住）：
        // 手动触发一次运行时快照回收 + 直接把 window/document 摘回 undefined，
        // 让 globalRuntime 轮询回调在下一拍拿到 undefined 后自清。
        try {
            const rt = fakeWin.VirtualPhone && fakeWin.VirtualPhone.motion;
            if (rt && rt.dispose) rt.dispose();
        } catch { /* 尽力而为 */ }
        try {
            for (const el of [fakeDoc.head, fakeDoc.body, fakeDoc.documentElement]) el.children.length = 0;
        } catch { /* 尽力而为 */ }
        // 还原全局（defineProperty 换过的键要走 defineProperty 还原，直接赋值会撞只读 getter）
        for (const k of Object.keys(prev)) {
            const desc = Object.getOwnPropertyDescriptor(g, k);
            if (desc && desc.get && !desc.set) {
                try { Object.defineProperty(g, k, { value: prev[k], configurable: true, writable: true }); }
                catch { /* 还原不了就算了：进程级测试，不会污染其它套件 */ }
            } else if (prev[k] === undefined) {
                try { delete g[k]; } catch { try { g[k] = undefined; } catch {} }
            } else {
                try { g[k] = prev[k]; } catch { /* 同上：只读键还原失败不致命 */ }
            }
        }
        fs.rmSync(path.resolve(repoDir, '..'), { recursive: true, force: true });
        // 常驻 interval 全部清掉（桩已 unref，这里再显式收一次，保证不留给后续用例）
        for (const id of intervals) { try { realClearInterval(id); } catch { /* 已停 */ } }
        intervals.length = 0;
        fs.rmSync(path.resolve(repoDir, '..'), { recursive: true, force: true });
    }
    return result;
}

test('H1 ★★★★★ 启动链冒烟：真加载入口后 VirtualPhone 装配完成（防 v4.54.1 同类 P0）', async () => {
    const rp = makeTree();
    const r = await bootOnce(rp, { expectMounted: true });
    assert.equal(r.mounted, true, '入口加载后 VirtualPhone 未装配完成：' + (r.threw || '（无错误记录，可能静默吞掉）'));
    assert.ok(r.version === '' || /^\d+\.\d+\.\d+$/.test(r.version), '装配点应给出版本读数');
});

test('H2 负控制：v4.450 同形破坏（装配点引用未定义标识符）必须让 H1 判据翻红', async () => {
    const rp = makeTree();
    breakLikeV4450(rp);
    const r = await bootOnce(rp, { expectMounted: false });
    assert.equal(r.mounted, false, '破坏后装配不应完成（负控制失效＝判据自我指涉）');
    assert.ok(r.threw, '破坏必须可观测（捕获到错误），否则判据根本没接上破坏');
});

test('H3 判据接的是真源码：真仓库装配点锚点恰好 1 次', () => {
    const s = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    assert.equal(s.split(ANCHOR).length - 1, 1, '装配点锚点漂移，冒烟判据需跟版');
});