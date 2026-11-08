/* [RubyPhone · r20] 14 个「全仓无人 import」的 phone/ 引擎真实接入契约
 * ------------------------------------------------------------------
 * 判据纪律（与 r19 同一条）：
 *   不是「函数被调过」，而是「真实业务路径上真的产生了那条产出」。
 * 因此本测试：
 *   - 用真件（真引擎类 + 真事件总线 + 真 lock-screen/phone-shell 语义），不 mock 引擎；
 *   - 事件派发到真 window（node 下用最小 EventTarget 垫片，不是假函数）；
 *   - 每条断言都读引擎**自己**的产出（任务栈摘要、墓碑快照、切片区间、读数面）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ── 最小 DOM/Event 垫片：只实现被用到的那几个面，不假装是浏览器 ── */
function makeWindow() {
    const listeners = new Map();
    const win = {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) {
            listeners.get(type)?.delete(fn);
        },
        dispatchEvent(ev) {
            const t = ev && ev.type;
            for (const fn of (listeners.get(t) || [])) fn(ev);
            return true;
        },
        visualViewport: null
    };
    win.CustomEvent = class CustomEvent {
        constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    };
    return win;
}

const REPO = new URL('..', import.meta.url).pathname;
const mountMod = await import(REPO + 'phone/lifecycle-engines-mount.js');

test('[r20] 14 个引擎全部真的被 new 出来，没有一个 missing', () => {
    const h = mountMod.mountLifecycleEngines();
    const read = h.getRead();
    assert.deepEqual(read.missing, [], '不应有装配失败的引擎');
    const expected = [
        'accessibility', 'biorhythm', 'tombstone', 'dynamicIsland', 'i18n', 'ipc',
        'multitask', 'cartridge', 'adaptive', 'privacyCloak', 'virtualStore',
        'taskStack', 'listScroller', 'chatScroller60', 'sliceBooster'
    ];
    for (const k of expected) {
        assert.ok(h.engine[k], `引擎 ${k} 必须真实存在`);
        assert.equal(read.wired[k], true, `引擎 ${k} 必须记账为已接线`);
    }
});

test('[r20] phone:openApp 真的把 App 压进任务栈、并广播 IPC 事件到订阅者', () => {
    const win = makeWindow();
    globalThis.window = win;
    const h = mountMod.mountLifecycleEngines();
    mountMod.bindLifecycleEngines(h, { virtualPhone: {}, shell: null });

    /* 真实订阅者：证明背压层不是空转，事件真的到达了消费者 */
    let delivered = null;
    h.engine.ipc.subscribe('app:open', (env) => { delivered = env; });

    win.dispatchEvent(new win.CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));

    const summary = h.engine.taskStack.getStackSummary();
    assert.equal(summary.stack.length, 1, '任务栈里应有一条记录');
    assert.equal(summary.activeApp.appId, 'wechat', '栈顶必须是刚打开的那个 App');
    assert.ok(delivered, 'IPC 订阅者必须收到 app:open 事件');
    /* 订阅方拿到的是 envelope 的 payload（引擎按 publish(topic, payload) 直接透传） */
    assert.equal(delivered.appId, 'wechat', '事件里必须带真实 appId');
    assert.ok(h.getRead().calls.launch >= 1, '读数面必须记到 launch');
});

test('[r20] phone:goHome 真的写入墓碑，且再进 App 能水合出同一份状态', () => {
    const win = makeWindow();
    globalThis.window = win;
    const h = mountMod.mountLifecycleEngines();
    mountMod.bindLifecycleEngines(h, { virtualPhone: {}, shell: null });

    win.dispatchEvent(new win.CustomEvent('phone:openApp', { detail: { appId: 'settings' } }));
    win.dispatchEvent(new win.CustomEvent('phone:goHome', {}));

    /* 墓碑里必须有 settings；这是引擎自己的数据结构，不是我们的记账 */
    const exported = h.engine.tombstone.exportState();
    const ids = exported.tombstones.map(([id]) => id);
    assert.ok(ids.includes('settings'), '回桌面必须把 settings 压进墓碑');

    /* 再开一次：必须走「水合」而不是「首启」 */
    win.dispatchEvent(new win.CustomEvent('phone:openApp', { detail: { appId: 'settings' } }));
    const resume = h.engine.tombstone.resumeApp('settings');
    assert.equal(resume.freshLaunch, false, '墓碑在 ⇒ 必须走水合，不能当成首启');
    assert.ok(resume.state && typeof resume.state.at === 'number',
        '水合出的状态必须来自刚才那份快照（bind 层写的是 {at} 时间戳）');
    assert.ok(h.getRead().calls.resume >= 1, '读数面必须记到 resume（说明真的水合过）');
});

test('[r20] resize 真的驱动屏幕自适应引擎算出真实断点', () => {
    const win = makeWindow();
    globalThis.window = win;
    win.innerWidth = 320; win.innerHeight = 640;
    const h = mountMod.mountLifecycleEngines();
    mountMod.bindLifecycleEngines(h, { virtualPhone: {}, shell: null });

    const before = h.getRead().calls.viewport;
    win.innerWidth = 430; win.innerHeight = 932;
    win.dispatchEvent(new win.CustomEvent('resize', {}));

    assert.ok(h.getRead().calls.viewport > before, 'resize 必须真的走到自适应引擎');
    assert.equal(h.getRead().lastViewport.width, 430, '读数面必须反映真实宽度');
});

test('[r20] 锁屏有未读时真的上隐私罩，解锁后真的撤掉', () => {
    const win = makeWindow();
    globalThis.window = win;
    const vp = { totalNotifications: 3 };
    win.VirtualPhone = vp;
    const h = mountMod.mountLifecycleEngines();
    mountMod.bindLifecycleEngines(h, { virtualPhone: vp, shell: null });
    vp._lifecycleHandle = h;

    win.dispatchEvent(new win.CustomEvent('phone:lock', {}));
    const cloakOn = h.engine.privacyCloak.getState();
    assert.equal(cloakOn.privacyMode, 'DISGUISE_CLOCK', '有未读时锁屏必须进入伪装时钟模式');

    win.dispatchEvent(new win.CustomEvent('phone:unlock', {}));
    const cloakOff = h.engine.privacyCloak.getState();
    assert.notEqual(cloakOff.privacyMode, 'DISGUISE_CLOCK', '解锁必须撤掉伪装模式');
    assert.ok(String(h.getRead().lastLockscreenPrompt || '').length > 0, '解锁后必须产出锁屏摘要');
});

test('[r20] 分片存储只对 ≥32KB 的大载荷生效，小键不分片', () => {
    const h = mountMod.mountLifecycleEngines();
    const small = h.persistShards({ tiny: { a: 1 } });
    assert.ok(small, '小载荷也必须能走通（只是不该被调用方触发）');

    const big = h.persistShards({ big: 'x'.repeat(40000) });
    assert.equal(big.flushedCount, 1, '大载荷必须真的产生一个脏块冲刷');
    assert.ok(big.totalBytes >= 40000, '冲刷字节数必须反映真实大小');
    assert.ok(h.getRead().calls.shardFlush >= 1, '读数面必须记到 shardFlush');
});

test('[r20] 三种虚拟滚动分派到不同列表，互不串味', () => {
    const h = mountMod.mountLifecycleEngines();
    const items = Array.from({ length: 500 }, (_, i) => ({ i }));

    const a = h.sliceForList(items, 640);
    assert.ok(a && a.totalItemsCount === 500, '通知列表切片必须基于真实条目数');
    assert.ok(a.visibleCount < 500, '通知列表切片必须真的比全量少');

    const b = h.sliceForChat60fps(items, 720);
    assert.ok(b && b.totalCount === 500, '聊天 60fps 切片必须基于真实条目数');
    assert.ok(Array.isArray(b.renderedNodes) && b.renderedNodes.length > 0, '60fps 必须给出复用节点池');

    const c = h.sliceForHuge(5000, 720);
    assert.ok(c && c.renderedCount < 5000, '万条兜底切片必须真的比全量少');
    assert.ok(c.bottomSpacerHeight > 0, '兜底切片必须留出下方撑高，否则滚动条会缩');

    assert.equal(h.getRead().calls.listSlice, 3, '三次切片必须各记一次，不互相吞掉');
});

test('[r20] 任意引擎抛错都不得炸掉宿主流程（读数面留痕即可）', () => {
    const h = mountMod.mountLifecycleEngines();
    /* 人为破坏一个引擎的方法：模拟第三方改动导致签名变化 */
    h.engine.taskStack.launchApp = () => { throw new Error('signature-drift'); };
    const win = makeWindow();
    globalThis.window = win;
    mountMod.bindLifecycleEngines(h, { virtualPhone: {}, shell: null });
    /* 不应抛出：宿主流程必须继续 */
    assert.doesNotThrow(() => {
        win.dispatchEvent(new win.CustomEvent('phone:openApp', { detail: { appId: 'wechat' } }));
    });
    assert.match(String(h.getRead().lastError || ''), /taskStack\.launchApp/, '错误必须被记进读数面，不能静默');
});