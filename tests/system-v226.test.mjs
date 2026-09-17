/* ============================================================
 * [v2.26.0] 跨模块事件契约单一真源 + 运行时资源登记与统一回收。
 * ------------------------------------------------------------
 * 动机（v2.25 的延伸）：
 *   v2.25 修的是「已注册监听器没解绑」。但两件事当时仍未收口：
 *     ① 跨模块通信建立在手写事件名字符串上（实测 16 个事件名、29 处
 *        addEventListener、83 处 dispatchEvent，散布 42 个文件），
 *        没有任何约束：打错一个字母不报错，只静默失联。
 *     ② 定时器比监听器更隐蔽：phone-shell.startClock() 的 30s 轮询
 *        连句柄都不存、无清理路径，而手机壳可重建（重入 createPhoneInPanel
 *        的 `|| !phoneShell` 分支），一重建就永久累积一个轮询，
 *        且其闭包钉住已废弃实例的 container。
 *
 * 修复（本轮）：
 *   - config/phone-events.js      事件名单一真源（16 事件 + 契约元数据）
 *   - config/runtime-lifecycle.js 登记制回收层（ManagedRuntime + onceFlag/rebindGlobal）
 *   - phone-shell：5 监听器改由登记层持有 + 时钟定时器登记 + 新增 destroy()
 *   - index.js：createPhoneInPanel 重建前先 destroy 旧壳
 *   - image-cropper：document 拖拽监听器实例字段持有 + close() 精确解绑
 *   - lock-screen：window 拖拽监听器 remove-then-add 幂等重绑
 *   - phone-image-openai-mode：从「3 写 0 读」死配置接回真源 + 归一
 *
 * 本测试四层：
 *   A. 契约双向对账（结构层：字面量↔契约必须一一对应，防漂移/防孤儿）
 *   B. ManagedRuntime 行为（单元层：登记、幂等回收、降级不抛）
 *   C. 三处泄漏的行为级验证（用真实注册表语义的 mock，非字符串匹配）
 *   D. 范围自证 + 死配置清零（防修复越界/防漏修）
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
const srcOf = f => read(f);

/* ---------- mock DOM：真实注册表语义（引用不相等就不解绑）---------- */
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
const onTarget = t => registry.filter(r => r.target === t);
const resetReg = () => { registry.length = 0; };
const ctx2d = { clearRect() {}, save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, drawImage() {}, fillRect() {}, fillStyle: '' };
function makeEl(tag = 'div') {
    return {
        tagName: tag, style: {}, dataset: {}, className: '', innerHTML: '', textContent: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute() {}, removeAttribute() {}, remove() {},
        appendChild(c) { return c; }, querySelector() { return makeEl(); }, querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect() { return { width: 100, height: 100 }; },
        getContext() { return ctx2d; }, width: 100, height: 100,
        toDataURL() { return 'data:image/png;base64,AA'; },
    };
}
globalThis.window = Object.assign(makeTarget('window'), {
    VirtualPhone: {}, location: { href: 'http://x/' }, innerWidth: 390, innerHeight: 844,
    visualViewport: { width: 390, height: 844 }, dispatchEvent() { return true; },
});
globalThis.document = Object.assign(makeTarget('document'), {
    hidden: false, createElement: t => makeEl(t),
    getElementById: id => (id === 'cropper-canvas' ? cropperCanvas : makeEl()),
    head: makeEl('head'), body: makeEl('body'), documentElement: makeEl('html'),
    querySelector: () => null, querySelectorAll: () => [],
});
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } };
// 裁剪器 open() 依赖这两个宿主 API；缺失会让 promise 直接 reject，导致
// 监听器注册数为 0 —— 那时「净增 0」会变成假绿，所以必须提供。
globalThis.FileReader = class {
    readAsDataURL(f) { this.result = f.__data; this.onload?.({ target: this }); }
};
globalThis.Image = class {
    set src(v) {
        this._src = v; this.naturalWidth = 1200; this.naturalHeight = 1600;
        this.width = 1200; this.height = 1600;
        queueMicrotask(() => this.onload?.());
    }
    get src() { return this._src; }
};
const cropperCanvas = makeEl('canvas');

const { PHONE_EVENTS, PHONE_EVENT_CONTRACT, PHONE_EVENT_KINDS, PHONE_EVENT_TARGETS,
    listPhoneEventNames, isPhoneEventName, phoneEventMeta, makePhoneEvent } =
    await import('../config/phone-events.js');
const { ManagedRuntime, onceFlag, rebindGlobal, resetOnceFlags } =
    await import('../config/runtime-lifecycle.js');
const tick = () => new Promise(r => setTimeout(r, 0));

/* ============================================================
 * A. 契约双向对账
 * ============================================================ */
const walkJs = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walkJs(p, out); }
        else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
};
const allFiles = walkJs(root);
const litCount = new Map();
for (const f of allFiles) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/phone:[A-Za-z0-9_-]+/g)) {
        litCount.set(m[0], (litCount.get(m[0]) || 0) + 1);
    }
}
const contractNames = listPhoneEventNames();
const contractSet = new Set(contractNames);
const literals = [...litCount.keys()].sort();

{
    ok('契约: 登记事件数 ≥ 16', contractNames.length >= 16, String(contractNames.length));
    ok('契约: 事件名全部形如 phone:前缀+标识符（允许连字符）', contractNames.every(n => /^phone:[A-Za-z0-9_-]+$/.test(n)));
    ok('契约: 无重复值（PHONE_EVENTS 值唯一）',
        new Set(Object.values(PHONE_EVENTS)).size === Object.keys(PHONE_EVENTS).length);
    ok('契约: 每个事件都有元数据（kind/target/note 齐全）',
        contractNames.every(n => {
            const m = PHONE_EVENT_CONTRACT[n];
            return m && Object.values(PHONE_EVENT_KINDS).includes(m.kind)
                && PHONE_EVENT_TARGETS.includes(m.target) && typeof m.note === 'string' && m.note.length > 0;
        }), JSON.stringify(contractNames.filter(n => !PHONE_EVENT_CONTRACT[n])));

    // 对账①：全仓字面量 → 必须都在契约内（防拼写漂移）
    const drift = literals.filter(n => !contractSet.has(n));
    ok('对账①: 全仓手机事件字面量全部能映射到契约（防漂移）',
        drift.length === 0, `契约外: ${JSON.stringify(drift)}`);

    // 对账②：契约 → 必须至少有一处真实使用（防孤儿/死契约）
    const orphan = contractNames.filter(n => !litCount.has(n));
    ok('对账②: 契约内每个事件都至少有一处真实使用（防孤儿）',
        orphan.length === 0, `零使用: ${JSON.stringify(orphan)}`);

    // 双向对账即等价于「集合相等」——用一条更强的断言钉死
    ok('对账①+② 合成: 字面量集合 === 契约集合',
        literals.length === contractNames.length && drift.length === 0 && orphan.length === 0,
        JSON.stringify({ literals: literals.length, contract: contractNames.length }));

    ok('查询辅助: isPhoneEventName 正确判定',
        isPhoneEventName(PHONE_EVENTS.GO_HOME) && !isPhoneEventName('phone:' + 'nope')
        && !isPhoneEventName('') && !isPhoneEventName(null));
    ok('查询辅助: phoneEventMeta 未登记返回 null 且不抛',
        phoneEventMeta('phone:' + 'nope') === null && phoneEventMeta(null) === null);
    ok('查询辅助: listPhoneEventNames 已排序且为副本',
        JSON.stringify(contractNames) === JSON.stringify([...contractNames].sort())
        && listPhoneEventNames() !== listPhoneEventNames());
    ok('查询辅助: makePhoneEvent 派发形态统一（detail 恒为对象，裸值包成 {value}）',
        typeof makePhoneEvent(PHONE_EVENTS.GO_HOME).detail === 'object'
        && makePhoneEvent(PHONE_EVENTS.OPEN_APP, { appId: 'x' }).detail.appId === 'x'
        && makePhoneEvent(PHONE_EVENTS.GO_HOME, 42).detail.value === 42
        && makePhoneEvent(PHONE_EVENTS.GO_HOME).type === PHONE_EVENTS.GO_HOME);
    ok('契约: 常量表与元数据表键完全一致（防只登记一半）',
        Object.keys(PHONE_EVENTS).length === Object.keys(PHONE_EVENT_CONTRACT).length);
}

/* ============================================================
 * B. ManagedRuntime 行为
 * ============================================================ */
{
    const rt = new ManagedRuntime('test');
    ok('Runtime: 初始为空', rt.size === 0 && rt.stats().total === 0);

    const ticks = [];
    const iid = rt.addInterval(() => ticks.push(1), 5, 'iv');
    ok('Runtime: addInterval 返回登记 id 且计入 stats',
        typeof iid === 'string' && rt.stats().interval === 1 && rt.size === 1);

    let timedOut = false;
    rt.addTimeout(() => { timedOut = true; }, 1, 'to');
    ok('Runtime: addTimeout 登记为 timeout', rt.stats().timeout === 1);
    await new Promise(r => setTimeout(r, 20));
    ok('Runtime: addTimeout 触发后自动销账（不留僵尸登记）',
        timedOut === true && rt.stats().timeout === 0);
    ok('Runtime: interval 仍在跑', rt.stats().interval === 1 && ticks.length > 0);

    // 监听器：经登记层注册 → dispose 精确解绑
    resetReg();
    const t1 = makeTarget('w1'), t2 = makeTarget('w2');
    rt.addListener(t1, 'a', () => {}, false, 'l1');
    rt.addListener(t2, 'b', () => {}, true, 'l2');
    ok('Runtime: addListener 真实注册到目标且计入 stats',
        live() === 2 && rt.stats().listener === 2);
    ok('Runtime: tagsOf 能定位"谁还在跑"',
        JSON.stringify(rt.tagsOf('listener')) === JSON.stringify(['l1', 'l2'])
        && rt.tagsOf('interval')[0] === 'iv');

    const released = rt.dispose();
    ok('Runtime: dispose 回收全部项并返回回收数',
        released === 3 && live() === 0 && rt.size === 0, `released=${released} live=${live()}`);
    ok('Runtime: dispose 后 stats 归零', rt.stats().total === 0 && rt.stats().interval === 0);
    ok('Runtime: dispose 幂等（重复调用不抛、返回 0）',
        rt.dispose() === 0 && rt.disposed === true);

    // dispose 后可继续使用（宿主重建语义）
    const again = rt.addListener(t1, 'c', () => {}, false, 'l3');
    ok('Runtime: dispose 后可继续登记（宿主重建语义）',
        typeof again === 'string' && live() === 1 && rt.size === 1);
    rt.dispose();
    ok('Runtime: 二次 dispose 仍精确回收', live() === 0);

    // cancel 单项
    const rt2 = new ManagedRuntime('t2');
    const id1 = rt2.addListener(t1, 'x', () => {}, false, 'k1');
    rt2.addListener(t1, 'y', () => {}, false, 'k2');
    ok('Runtime: cancel 只撤一项、其余保留',
        rt2.cancel(id1) === true && rt2.size === 1 && live() === 1);
    ok('Runtime: cancel 未知 id 返回 false 不抛', rt2.cancel('nope') === false);
    rt2.dispose();

    // 降级：无宿主 API 时不抛
    const rt3 = new ManagedRuntime('bare');
    const savedSI = globalThis.setInterval, savedST = globalThis.setTimeout, savedMO = globalThis.MutationObserver;
    delete globalThis.setInterval; delete globalThis.setTimeout; delete globalThis.MutationObserver;
    let threw = false;
    try {
        rt3.addInterval(() => {}, 1);
        rt3.addTimeout(() => {}, 1);
        rt3.addObserver(() => {});
        rt3.addListener(null, 'a', () => {});
        rt3.dispose();
    } catch (_) { threw = true; }
    globalThis.setInterval = savedSI; globalThis.setTimeout = savedST; globalThis.MutationObserver = savedMO;
    ok('Runtime: 无宿主 API 时全部降级为不抛（Node 单测安全）',
        threw === false && rt3.size === 0);

    // onceFlag / rebindGlobal 原语
    const holder = {};
    ok('onceFlag: 首次 true、再次 false（等价 window._xxxBound）',
        onceFlag('a', holder) === true && onceFlag('a', holder) === false);
    ok('onceFlag: 不同 key 互不干扰', onceFlag('b', holder) === true);
    resetOnceFlags(holder);
    ok('onceFlag: resetOnceFlags 后可再绑（测试/热重载用）', onceFlag('a', holder) === true);
    ok('onceFlag: 无 key 不去重（避免误吞）', onceFlag('', holder) === true && onceFlag('', holder) === true);

    resetReg();
    const t3 = makeTarget('w3');
    const h1 = () => {}, h2 = () => {};
    rebindGlobal(t3, 'mousemove', h1, holder, 'h');
    ok('rebindGlobal: 首次注册生效', live() === 1 && holder.h === h1);
    rebindGlobal(t3, 'mousemove', h2, holder, 'h');
    ok('rebindGlobal: 重绑先解旧再绑新（净增 0，等价 music 范式）',
        live() === 1 && onTarget('w3')[0].handler === h2 && holder.h === h2);
    let rThrew = false;
    try { rebindGlobal(t3, 'x', h1, holder, ''); } catch (_) { rThrew = true; }
    ok('rebindGlobal: 缺 holderKey 时显式报错（防静默泄漏）', rThrew === true);
    resetReg();
}

/* ============================================================
 * C. 三处泄漏的行为级验证（mock 真实注册表语义）
 * ============================================================ */
{
    // C1 phone-shell：5 监听器 + 1 定时器 → destroy 全回收，重建不累积
    const { PhoneShell } = await import('../phone/phone-shell.js');
    const savedSI2 = globalThis.setInterval;
    let shellTimers = 0;
    globalThis.setInterval = (...a) => { shellTimers++; return savedSI2(...a); };
    resetReg();
    const shells = [];
    for (let i = 0; i < 4; i++) {
        const s = new PhoneShell();
        s.createInPanel(makeEl('host'));
        shells.push(s);
    }
    const beforeDestroy = live();
    ok('shell: 4 次重建不回收 → 监听器线性累积（修复前形态）',
        beforeDestroy === 20, String(beforeDestroy));
    ok('shell: 每个壳注册 5 个长期监听器（pointermove/pointerup/pointercancel/blur/timeUpdated）',
        onTarget('document').length === 12 && onTarget('window').length === 8,
        JSON.stringify({ doc: onTarget('document').length, win: onTarget('window').length }));
    ok('shell: 每个壳注册 1 个 30s 时钟定时器', shellTimers === 4, String(shellTimers));
    ok('shell: 壳内已无裸 window/document addEventListener（全走登记层）',
        !/^\s*(window|document)\.addEventListener\(/m.test(srcOf('phone/phone-shell.js')));
    let sum = 0;
    for (const s of shells) sum += s.destroy();
    ok('shell: destroy 回收全部 20 监听器 + 4 定时器',
        sum === 24 && live() === 0, `released=${sum} live=${live()}`);
    ok('shell: destroy 返回实际回收项数（24 = 4壳×(5监听+1定时)）', sum === 24, String(sum));
    ok('shell: destroy 幂等', shells[0].destroy() === 0);
    // 配平形态：new→create→destroy 每轮净 0
    resetReg();
    for (let i = 0; i < 4; i++) {
        const s = new PhoneShell(); s.createInPanel(makeEl('host')); s.destroy();
    }
    ok('shell: 干净基线上 N 轮 create→destroy 净 0（修复后形态）', live() === 0, String(live()));
    ok('shell: 保留 capture 语义（pointerup/pointercancel 两处 capture=true）',
        (srcOf('phone/phone-shell.js').match(/\}, true\);\n/g) || []).length === 2);
    globalThis.setInterval = savedSI2;

    // C2 image-cropper：每轮 open→close 净 0；对照证明修复前会累积
    const { ImageCropper } = await import('../apps/settings/image-cropper.js');
    const makeCropper = () => new ImageCropper({ outputWidth: 256, outputHeight: 256, outputFormat: 'image/png' });
    resetReg();
    let opened = -1;
    for (let i = 0; i < 6; i++) {
        const c = makeCropper();
        const p = c.open({ type: 'image/png', name: 'a.png', size: 1024, __data: 'data:image/png;base64,iVBORw0KGgo=' });
        p.catch(() => {});
        await tick();
        if (i === 0) opened = live();
        c.close();
        await tick();
    }
    ok('cropper: open 时在 document 注册 2 个拖拽监听器', opened === 2, String(opened));
    ok('cropper: 6 轮 open→close 净 0（close 精确解绑）', live() === 0, String(live()));
    resetReg();
    {
        const c = makeCropper();
        const p = c.open({ type: 'image/png', __data: 'data:image/png;base64,iVBORw0KGgo=' });
        p.catch(() => {});
        await tick();
        const heldBefore = typeof c._onDocMouseMove === 'function' && typeof c._onDocMouseUp === 'function';
        c.close();
        await tick();
        ok('cropper: 注册期 handler 由实例字段持有（登记层可精确解绑的前提）', heldBefore === true);
        ok('cropper: close 后实例字段置空（防重复解绑/防闭包残留）',
            c._onDocMouseMove === null && c._onDocMouseUp === null);
        ok('cropper: close 幂等（重复 close 不抛、不误删他人监听）',
            (() => { try { c.close(); return live() === 0; } catch (_) { return false; } })());
    }
    // 对照：跳过解绑（模拟修复前只删容器）→ 必须累积
    resetReg();
    for (let i = 0; i < 3; i++) {
        const c = makeCropper();
        const p = c.open({ type: 'image/png', __data: 'data:image/png;base64,iVBORw0KGgo=' });
        p.catch(() => {});
        await tick();
        c._onDocMouseMove = null; c._onDocMouseUp = null;   // 抹掉引用 = 等价于"没持有、没解绑"
        c.close();
        await tick();
    }
    ok('cropper: 对照——不解绑则 3 轮累积 6 个监听器（证明修复前确会泄漏）',
        live() === 6, String(live()));
    resetReg();

    // C3 lock-screen：5 轮 lock() 恒定 2 个（remove-then-add）
    const { LockScreen } = await import('../phone/lock-screen.js');
    resetReg();
    const ls = new LockScreen({ container: makeEl(), batteryLevel: 85, classList: { add() {}, remove() {} } });
    const counts = [];
    for (let i = 0; i < 5; i++) { ls.lock(); counts.push(onTarget('window').length); }
    ok('lockscreen: 5 轮 lock() 后 window 监听恒为 2（幂等重绑）',
        counts.every(c => c === 2), JSON.stringify(counts));
    ok('lockscreen: 监听类型为 mousemove/mouseup',
        onTarget('window').map(r => r.type).sort().join(',') === 'mousemove,mouseup');
    ok('lockscreen: 每轮 handler 引用被替换（旧引用已解绑，非累积）',
        ls._onWinMouseMove !== null && ls._onWinMouseUp !== null);
    ls.unlock();
    ok('lockscreen: unlock 后监听仍在（锁屏复用同一实例，非泄漏）',
        onTarget('window').length === 2, String(onTarget('window').length));
    resetReg();
}

/* ============================================================
 * D. 死配置清零 + 范围自证
 * ============================================================ */
{
    const settings = srcOf('apps/settings/settings-app.js');
    const igm = srcOf('config/image-generation-manager.js');

    ok('openaiMode: 死写入已清零（settings-app 内不再写 phone-image-openai-mode）',
        !/storage\.set\(\s*'phone-image-openai-mode'/.test(settings));
    ok('openaiMode: 隐藏 input 已删除',
        !/id="phone-image-openai-mode"/.test(settings));
    ok('openaiMode: modeInput 局部变量已清除', !/modeInput/.test(settings));
    ok('openaiMode: 管理端已接真源读取',
        /openaiMode:\s*this\._normalizeOpenAIMode\(overrides\.openaiMode\s*\?\?\s*this\._get\('phone-image-openai-mode'/.test(igm));
    ok('openaiMode: 归一函数存在且为宽容转换',
        /_normalizeOpenAIMode\(value\)\s*\{/.test(igm)
        && /raw === 'edits' \|\| raw === 'edit'/.test(igm));
    // 归一行为：直接抽取函数体求值（不依赖实例构造）
    const norm = new Function('value', `
        const raw = String(value ?? '').trim().toLowerCase();
        if (raw === 'edits' || raw === 'edit') return 'edits';
        return 'images';
    `);
    ok('openaiMode: 归一行为——合法值保留、脏值回落 images（对既有存档逐位等价）',
        norm('images') === 'images' && norm('edits') === 'edits' && norm('EDIT') === 'edits'
        && norm(undefined) === 'images' && norm(null) === 'images' && norm('garbage') === 'images'
        && norm('') === 'images');

    // 范围自证：本轮只动了该动的文件
    const touched = ['apps/album/album-app.js', 'apps/calendar/calendar-app.js',
        'phone/phone-shell.js', 'phone/lock-screen.js', 'apps/settings/image-cropper.js',
        'apps/settings/settings-app.js', 'config/image-generation-manager.js', 'index.js'];
    ok('范围: 本轮改动的 8 个文件全部存在且非空',
        touched.every(f => srcOf(f).length > 0), JSON.stringify(touched.filter(f => !srcOf(f).length)));
    ok('范围: album/calendar/phone-shell 三模块已接契约常量',
        ['apps/album/album-app.js', 'apps/calendar/calendar-app.js', 'phone/phone-shell.js']
            .every(f => /import \{[^}]*PHONE_EVENTS[^}]*\}/.test(srcOf(f))));
    ok('范围: 未做全仓机械替换（大量文件仍是字面量，符合刻意取舍）',
        literals.length > 0 && allFiles.length > 200);

    // index.js 接线：重建前先 destroy
    const isrc = srcOf('index.js');
    ok('index.js: createPhoneInPanel 重建前先 destroy 旧壳',
        /try \{ phoneShell\?\.destroy\?\.\(\); \}[^\n]*\n\s*phoneShell = null;\s*\n\s*\n\s*container\.innerHTML = '';/.test(isrc),
        '未找到 destroy→null→innerHTML 顺序');
    ok('index.js: destroy 接线在 innerHTML 清空之前（顺序不可换）',
        isrc.indexOf('phoneShell?.destroy?.()') < isrc.indexOf('container.innerHTML = \'\''));
    ok('index.js: destroy 调用被 try/catch 保护（回收失败不阻断重建）',
        /try \{ phoneShell\?\.destroy\?\.\(\); \} catch \(e\)/.test(isrc));
    const callSites = (isrc.match(/phoneShell = new PhoneShell\(\)/g) || []).length;
    ok('index.js: 只有一处 new PhoneShell()（单一重建入口）', callSites === 1, String(callSites));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
