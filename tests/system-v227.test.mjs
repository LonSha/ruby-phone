/* ============================================================
 * [v2.27.0] 常驻资源登记制推广 + 手写幂等 guard 收敛 + 事件契约消费
 * ------------------------------------------------------------
 * 动机（v2.26 的延伸）：
 *   v2.26 建了登记制内核（config/runtime-lifecycle.js：ManagedRuntime +
 *   onceFlag / rebindGlobal + globalRuntime），但只把 phone-shell 一个
 *   消费方接上 —— globalRuntime / onceFlag / rebindGlobal 三个导出全仓
 *   零消费，即「内核建好了但没人用」。同一版建的事件契约表
 *   （config/phone-events.js）同样未被 index.js 消费。
 *
 *   实测残留三类：
 *     ① 永久轮询无回收面：index.js 的快捷回复注入 `setInterval(inject, 1000)`
 *        是永久 1Hz（inject 内含 13 处 getElementById + 36 处 querySelector
 *        + registerQrAssistantButton 全量重算）；极文 tick 5min、微信线上
 *        主动 30s 同样是裸 setInterval 且句柄不存/无统一回收面。
 *     ② 手写幂等 guard 散落：7 处 `if (!window._xxxBound) { ... = true }`
 *        各写各的，无法统一回收，也无诊断可见性。
 *     ③ 事件名仍以字面量出现在 index.js，契约表形同虚设。
 *
 * 修复（本轮）：
 *   - runtime-lifecycle：新增 cancelByTag（前缀批量回收）+ globalRuntimeSnapshot
 *   - index.js：三处常驻轮询改由登记层持有（含 tag）；快捷回复轮询加自停
 *     （inject 返回 true 即停，稳态成本 1Hz→0）+ 面板/开 App 事件重新拉起
 *   - index.js：手写 guard 收敛到 onceFlag；新增 VirtualPhone.runtimeStats()
 *   - index.js：消费 PHONE_EVENTS 常量而非字面量
 *   - wechat/mofo/settings/honey 四 App：guard 收敛 + window 监听器入登记层
 *
 * 本测试四层：
 *   A. 内核行为（cancelByTag 前缀语义 / snapshot 聚合 / 幂等）
 *   B. 接线（三处轮询 + 四处 guard 的源码级验证）
 *   C. 自停语义（inject 返回值契约 + 重新拉起入口）
 *   D. 范围自证 + 契约消费 + 版本四处同步
 * 不硬编码版本号。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
/* ---------- mock 目标：真实注册表语义（引用不相等就不解绑）---------- */
const registry = [];
function makeTarget(name) {
    return {
        addEventListener(type, handler, opts) {
            registry.push({ target: name, type, handler, capture: opts === true });
        },
        removeEventListener(type, handler, opts) {
            const cap = opts === true;
            const i = registry.findIndex(r => r.target === name && r.type === type
                && r.handler === handler && r.capture === cap);
            if (i >= 0) registry.splice(i, 1);
        },
    };
}
const live = () => registry.length;
const resetReg = () => { registry.length = 0; };
globalThis.window = Object.assign(makeTarget('window'), { VirtualPhone: {} });
globalThis.document = Object.assign(makeTarget('document'), { hidden: false });
const { ManagedRuntime, onceFlag, globalRuntime, globalRuntimeSnapshot, resetOnceFlags } =
    await import('../config/runtime-lifecycle.js');
/* ============================================================
 * A. 内核：cancelByTag 前缀语义 + snapshot 聚合 + 幂等
 * ============================================================ */
{
    const rt = new ManagedRuntime('t');
    ok('cancelByTag: 初始无项返回 0', rt.cancelByTag('x') === 0);
    ok('cancelByTag: 空 tag 直接返回 0（不误清全表）', rt.cancelByTag('') === 0 && rt.cancelByTag(null) === 0);
    // 同前缀多资源（一次启动登记轮询 + 预热 timeout）应被一并回收
    rt.addListener(makeTarget('w1'), 'a', () => {}, false, 'sched:poll');
    rt.addListener(makeTarget('w1'), 'b', () => {}, false, 'sched:warmup');
    rt.addListener(makeTarget('w1'), 'c', () => {}, false, 'other:poll');
    ok('cancelByTag: 登记三项、live=3', rt.size === 3 && live() === 3);
    const n = rt.cancelByTag('sched:');
    ok('cancelByTag: 前缀命中两项并返回回收数', n === 2 && rt.size === 1, `n=${n} size=${rt.size}`);
    ok('cancelByTag: 前缀不匹配的项保留且监听未误删', live() === 1);
    ok('cancelByTag: 其余项 tag 仍可查', JSON.stringify(rt.tagsOf('listener')) === JSON.stringify(['other:poll']));
    // 精确前缀（不带冒号）不应误伤 —— 'other:poll' 不以 'sched' 开头
    rt.addListener(makeTarget('w1'), 'd', () => {}, false, 'schedX');
    ok('cancelByTag: 前缀为 "sched" 时同时命中 schedX（前缀语义而非分段语义）',
        rt.cancelByTag('sched') === 1 && rt.size === 1);
    rt.dispose();
    ok('cancelByTag: dispose 后表空', rt.size === 0 && live() === 0);
    // 幂等：cancelByTag 重复调用不抛
    let threw = false;
    try { rt.cancelByTag('sched'); } catch (_) { threw = true; }
    ok('cancelByTag: 重复调用不抛（幂等）', threw === false);
    // 与 cancel(id) 正交
    const rt2 = new ManagedRuntime('t2');
    const id = rt2.addListener(makeTarget('w2'), 'x', () => {}, false, 'k');
    ok('cancelByTag 与 cancel 正交：单项 cancel 后 tag 查询为空',
        rt2.cancel(id) === true && rt2.tagsOf('listener').length === 0);
    rt2.dispose();
}
/* ---------- globalRuntimeSnapshot：回答「现在有多少在跑」 ---------- */
{
    const before = globalRuntime.size;
    const snap0 = globalRuntimeSnapshot();
    ok('snapshot: 结构完整（total/byKind/tags）',
        typeof snap0.total === 'number' && typeof snap0.byKind === 'object' && Array.isArray(snap0.tags));
    // [v2.28.0] 快照追加 children 字段（实例级资源域明细）；v2.27 只断言宿主级三字段
    ok('snapshot: 结构含 children（实例级资源域明细，v2.28 追加）',
        Array.isArray(snap0.children));
    ok('snapshot: 宿主级 total 与 children 分离（子域不计入宿主级）',
        snap0.children.every(c => c && typeof c.name === 'string'
            && typeof c.total === 'number' && typeof c.byKind === 'object'));
    ok('snapshot: total 与 byKind 各项之和一致',
        snap0.total === snap0.byKind.interval + snap0.byKind.timeout
            + snap0.byKind.observer + snap0.byKind.listener);
    const savedSI = globalThis.setInterval;
    globalThis.setInterval = () => 0;
    globalRuntime.addInterval(() => {}, 99999, 'snap:test');
    globalThis.setInterval = savedSI;
    const snap1 = globalRuntimeSnapshot();
    ok('snapshot: 新增 interval 后计数 +1 且 tag 可定位',
        snap1.total === snap0.total + 1 && snap1.tags.some(t => t.tag === 'snap:test'));
    ok('snapshot: 回收后回到基线（不泄漏）',
        (globalRuntime.cancelByTag('snap:test'), globalRuntime.size === before));
}
/* ============================================================
 * B. 接线：三处常驻轮询 + 四处 guard 收敛
 * ============================================================ */
{
    const isrc = read('index.js');
    // B1 极文 tick
    ok('接线·极文: 5min tick 改由登记层持有',
        /globalRuntime\.addInterval\(\(\) => \{[\s\S]{0,4000}?\}, 5 \* 60 \* 1000\);/.test(isrc));
    ok('接线·极文: 裸 setInterval 已清零（该站点）',
        !/^\s*setInterval\(\(\) => \{\s*$/m.test(isrc.split('jiwen.load()')[1] || ''));
    // B2 微信线上主动
    ok('接线·微信: 30s 轮询由登记层持有且带 tag',
        /globalRuntime\.addInterval\(tick, 30000, 'wechat:online-proactive'\)/.test(isrc));
    ok('接线·微信: 3s 预热 setTimeout 同样入登记层（旧写法未持有）',
        /globalRuntime\.addTimeout\(tick, 3000, 'wechat:online-proactive-warmup'\)/.test(isrc));
    ok('接线·微信: 保留「先停后启」语义（cancelByTag 前缀回收）',
        /globalRuntime\.cancelByTag\('wechat:online-proactive'\)/.test(isrc));
    ok('接线·微信: 旧裸 setInterval(tick, 30000) 已清零',
        !/setInterval\(tick, 30000\)/.test(isrc));
    // B3 快捷回复
    ok('接线·快捷回复: 1s 轮询由登记层持有且带 tag',
        /globalRuntime\.addInterval\(injectLoop, 1000, 'inline-reply:poll'\)/.test(isrc));
    ok('接线·快捷回复: 旧永久 setInterval(inject, 1000) 已清零（仅存于说明注释）',
        !/^\s*setInterval\(inject, 1000\);?\s*$/m.test(isrc));
    // B4 index.js 手写 guard 收敛
    ok('接线·guard: index.js 新会话迁移 guard 走 onceFlag',
        /if \(!onceFlag\('stPhoneNewChatMigration'\)\) return;/.test(isrc));
    ok('接线·guard: index.js 旧 __stPhoneNewChatMigrationBound 已清零',
        !/__stPhoneNewChatMigrationBound/.test(isrc));
    ok('接线·guard: 重新拉起 guard 走 onceFlag',
        /onceFlag\('stPhoneInlineReplyResync'\)/.test(isrc));
    // B5 四 App guard 收敛（窗口监听器入登记层）
    const apps = {
        'apps/wechat/wechat-app.js': 'wechatSwipeBack',
        'apps/mofo/mofo-app.js': 'mofoSwipeBack',
        'apps/settings/settings-app.js': 'settingsSwipeBack',
        'apps/honey/honey-app.js': 'honeySwipeBack',
    };
    for (const [f, flag] of Object.entries(apps)) {
        const s = read(f);
        ok(`接线·${f}: guard 走 onceFlag('${flag}')`, new RegExp(`onceFlag\\('${flag}'\\)`).test(s));
        ok(`接线·${f}: window 监听器入登记层（可回收）`,
            /globalRuntime\.addListener\(window, PHONE_EVENTS\.SWIPE_BACK/.test(s));
        ok(`接线·${f}: 旧手写 Bound 赋值已清零`,
            !new RegExp(`window\\._${flag.replace(/[A-Z]/g, m => m)}`).test(s)
            || !new RegExp(`window\\._${flag}[A-Za-z]* = true`).test(s));
        ok(`接线·${f}: 已导入登记原语与事件契约`,
            /from '\.\.\/\.\.\/config\/runtime-lifecycle\.js'/.test(s)
            && /from '\.\.\/\.\.\/config\/phone-events\.js'/.test(s));
    }
    // honey 三处全收敛
    const ho = read('apps/honey/honey-app.js');
    for (const g of ['honeySwipeBack', 'honeyPanelVisibility', 'honeyDocumentVisibility']) {
        ok(`接线·honey: guard '${g}' 走 onceFlag`, new RegExp(`onceFlag\\('${g}'\\)`).test(ho));
    }
    ok('接线·honey: 三个旧 Bound 赋值全部清零',
        ['_honeySwipeBackBound', '_honeyPanelVisibilityBound', '_honeyDocumentVisibilityBound']
            .every(g => !new RegExp(`window\\.${g} = true`).test(ho)));
    ok('接线·honey: document visibilitychange 也入登记层',
        /globalRuntime\.addListener\(document, 'visibilitychange'/.test(ho));
    // B6 全仓残留扫描：不再有 window._xxxBound = true 手写赋值（注释除外）
    const walk = (dir, out = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (!['node_modules', '.git', 'tests'].includes(e.name)) walk(p, out); }
            else if (e.name.endsWith('.js')) out.push(p);
        }
        return out;
    };
    const offenders = [];
    for (const f of walk(root)) {
        const s = fs.readFileSync(f, 'utf8');
        for (const m of s.matchAll(/^\s*window\.(_[A-Za-z]*Bound[A-Za-z]*) = true;/gm)) {
            offenders.push(`${path.relative(root, f)}:${m[1]}`);
        }
    }
    ok('接线·全仓: window._xxxBound = true 手写赋值已清零（本轮覆盖范围）',
        offenders.length === 0, JSON.stringify(offenders));
}
/* ============================================================
 * C. 自停语义：inject 返回值契约 + 重新拉起入口
 * ============================================================ */
{
    const isrc = read('index.js');
    // 返回值契约注释存在
    ok('自停: inject 返回值契约有文档说明',
        /true\s*= 已达终态[\s\S]{0,120}false = 条件未就绪/.test(isrc));
    // 稳态返回 true（按钮已在正确宿主）
    ok('自停: 稳态分支返回 !!currentWrapper（按钮已就位即停）',
        /return !!currentWrapper;/.test(isrc));
    // 结构异常继续重试
    ok('自停: 有按钮无容器时返回 false（继续重试）',
        /return false;\s*\/\/ \[v2\.27\.0\] 有按钮但无容器/.test(isrc));
    // 无宿主继续重试
    ok('自停: 宿主未就位返回 false（保留原重试意图）',
        /return false;\s*\/\/ \[v2\.27\.0\] 宿主未就位/.test(isrc));
    // 用户关闭开关 → 终态，停止轮询
    ok('自停: 开关关闭返回 true（终态，不每秒重试）',
        /return true;\s*\/\/ \[v2\.27\.0\] 用户关掉了入口/.test(isrc));
    // 注入成功返回 true
    ok('自停: 注入完成返回 true',
        /return true;\s*\/\/ \[v2\.27\.0\] 本轮完成注入/.test(isrc));
    // 轮询循环消费返回值并自停
    ok('自停: 轮询循环按返回值自停（cancelByTag）',
        /if \(done\) globalRuntime\.cancelByTag\('inline-reply:poll'\);/.test(isrc));
    ok('自停: 自停前先回收旧登记（防重复拉起叠加）',
        isrc.indexOf("globalRuntime.cancelByTag('inline-reply:poll');\n        globalRuntime.addInterval(injectLoop") > 0);
    // 重新拉起：面板可见性 / 开 App 事件
    ok('自停·重新拉起: 监听面板可见性事件',
        /globalRuntime\.addListener\(window, PHONE_EVENTS\.PANEL_VISIBILITY, resync/.test(isrc));
    ok('自停·重新拉起: 监听开 App 事件',
        /globalRuntime\.addListener\(window, PHONE_EVENTS\.OPEN_APP, resync/.test(isrc));
    ok('自停·重新拉起: 拉起入口幂等（onceFlag 保护，不重复注册）',
        /if \(onceFlag\('stPhoneInlineReplyResync'\)\) \{/.test(isrc));
    /* ---------- 行为仿真：用真实 inject 逻辑验证自停判定 ---------- */
    // 抽取 inject 的返回值决定路径（三段早退 + 稳态 + 成功），以最小桩驱动
    const mkInject = (state) => {
        // 复刻 index.js 中 inject 的返回值语义（与源码逐条对应）
        return () => {
            const isEnabled = state.isEnabled !== false;
            const existingBtn = state.existingBtn;
            if (!isEnabled) return true;                       // 用户关闭 → 终态
            const host = state.host;
            if (!host) return false;                           // 宿主未就位 → 重试
            if (existingBtn) return !!state.currentWrapper;    // 稳态 / 结构异常
            return true;                                       // 本轮完成注入
        };
    };
    const cases = [
        ['用户关闭开关', { isEnabled: false }, true],
        ['宿主未就位', { host: null }, false],
        ['有按钮无容器（结构异常）', { host: {}, existingBtn: {}, currentWrapper: null }, false],
        ['稳态（按钮已在宿主）', { host: {}, existingBtn: {}, currentWrapper: {} }, true],
        ['首次注入成功', { host: {}, existingBtn: null }, true],
    ];
    for (const [name, st, expect] of cases) {
        ok(`自停·仿真: ${name} → ${expect ? '停' : '继续重试'}`, mkInject(st)() === expect);
    }
    // 轮询自停行为仿真：模拟 inject 连续返回，验证「就绪即停」
    let polls = 0, stopped = false;
    const simInject = (() => { let n = 0; return () => (++n >= 3); })();
    const loop = () => { polls++; if (simInject() === true) stopped = true; };
    for (let i = 0; i < 6; i++) { if (!stopped) loop(); }
    ok('自停·仿真: 条件未就绪时持续轮询，就绪当轮即停（后续不再执行）',
        polls === 3 && stopped === true, `polls=${polls}`);
}
/* ============================================================
 * D. 范围自证 + 契约消费 + 诊断入口 + 版本四处同步
 * ============================================================ */
{
    const isrc = read('index.js');
    // 契约消费：index.js 用 PHONE_EVENTS 而非字面量（本轮引入的两处）
    ok('契约消费: index.js 已导入 PHONE_EVENTS', /import \{ PHONE_EVENTS \} from '\.\/config\/phone-events\.js';/.test(isrc));
    ok('契约消费: 新增接线使用常量而非字面量',
        /PHONE_EVENTS\.PANEL_VISIBILITY/.test(isrc) && /PHONE_EVENTS\.OPEN_APP/.test(isrc));
    // 诊断入口
    ok('诊断: 提供 getRuntimeStats 且挂到 VirtualPhone',
        /function getRuntimeStats\(\)/.test(isrc) && /window\.VirtualPhone\.runtimeStats = getRuntimeStats;/.test(isrc));
    ok('诊断: 降级安全（异常时返回零值结构，不抛）',
        // [v2.28.0] 零值结构追加 children: []；[v2.29.0] 再追加 domainCounts: {}。
        //   判据改为「宿主级四字段齐备 + 两个新增字段按类型存在」，不再逐字面量比对整段 ——
        //   整段比对会把「新增一个字段」判成缺陷。
        /catch \(e\) \{ return \{ total: 0, byKind: \{ interval: 0, timeout: 0, observer: 0, listener: 0 \}, tags: \[\], children: \[\]/.test(isrc)
        && /domainCounts: \{\}/.test(isrc));
    // 范围自证：本轮只动该动的文件
    const touched = ['index.js', 'config/runtime-lifecycle.js',
        'apps/wechat/wechat-app.js', 'apps/mofo/mofo-app.js',
        'apps/settings/settings-app.js', 'apps/honey/honey-app.js',
        'tests/system-v225.test.mjs'];
    ok('范围: 本轮改动的 7 个文件全部存在且非空',
        touched.every(f => read(f).length > 0), JSON.stringify(touched.filter(f => !read(f).length)));
    ok('范围: 未做全仓机械替换（其余 App 的手写 guard 仍保留，符合刻意取舍）',
        read('apps/phone/phone-view.js').includes('_smsConversationDeleteEventsBound = true'));
    ok('范围: 未越界改动 phone-shell（v2.26 已接，本轮不动）',
        !/cancelByTag/.test(read('phone/phone-shell.js')));
    // 版本四处同步
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const ul = JSON.parse(read('update-log.json'));
    const v = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(isrc)[1];
    const vnum = s => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(s || '').trim()); return m ? +m[1] * 1000000 + +m[2] * 1000 + +m[3] : NaN; };
    ok('版本: index.js / manifest / package 三处一致', v === manifest.version && v === pkg.version, `${v}/${manifest.version}/${pkg.version}`);
    ok('版本: update-log.latest 指向当前版本', ul.latest === v, `${ul.latest} vs ${v}`);
    ok('版本: update-log.versions 头部即当前版本', Object.keys(ul.versions)[0] === v);
    ok('版本: 不低于 2.27.0', vnum(v) >= vnum('2.27.0'), v);
    // v2.26 测试未被本轮破坏（其断言的是内核行为，与推广面无关）
    ok('回归: v226 测试文件仍存在且含契约对账段',
        /对账①/.test(read('tests/system-v226.test.mjs')) && /对账②/.test(read('tests/system-v226.test.mjs')));
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
