/* ============================================================
 * [v2.21.0] 世界脉搏换会话生命周期重绑 + 入口乐观出队 回归测试。
 * ------------------------------------------------------------
 * 背景（本批次修复的真实缺陷，v2.20 修复后审计新发现）：
 *  1. 换会话监听泄漏 + 基线幻影：worldpulse 实例跨会话复用，
 *     _listening/_unsub/_pollTimer 为实例级内存态；onChatChanged
 *     清理清单（十余个 App 均被清理）独漏 worldpulse。换会话后监听
 *     仍挂在旧上下文，且新会话状态键为空（lastFloorCount=0），
 *     会把「新会话当前楼层 - 0」当作积压量误触发一次幻影脉冲。
 *  2. v2.20 修复的残余漏洞：_processQueue 的出队步在生成完成后
 *     无条件执行，换会话后读到的是新会话队列，会把新会话自己的
 *     待处理事件悄悄砍掉一条；切回旧会话还会把已生成过的事件重复生成。
 *     修复为「入口乐观出队」：getState 与 _saveState 之间为同步区间
 *     （无 await），此刻必为发起会话，同步移除待处理事件。
 *
 * 分工：真实运行时（WorldpulseApp 实例 + 会话路由内存 storage + 事件源桩）
 *       + 接线断言（源码文本）。不硬编码版本号。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldpulseApp } from '../apps/worldpulse/worldpulse-app.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 会话路由内存 storage：按 ctxHolder.chatMetadata.file_name 分桶（模拟会话隔离）。
// worldpulse 的 get/set 全走 storage，切换 session 变量即可模拟换会话。
function makeEnv() {
    const buckets = {};
    let session = 'A';
    const ctxHolder = {
        chatMetadata: { file_name: 'A' },
        chat: new Array(8).fill({}),
        eventSource: null,
        event_types: null
    };
    const storage = {
        get(k, dflt = null) { const b = buckets[session] || {}; return (k in b) ? b[k] : dflt; },
        set(k, v) { (buckets[session] = buckets[session] || {})[k] = v; }
    };
    globalThis.window = Object.assign(globalThis.window || {}, {
        SillyTavern: { getContext: () => ctxHolder },
        VirtualPhone: {}
    });
    return {
        buckets,
        ctxHolder,
        storage,
        setSession(s) { session = s; ctxHolder.chatMetadata.file_name = s; }
    };
}
function makeEventSource() {
    return {
        handlers: [],
        onCount: 0,
        removeCount: 0,
        on(_e, h) { this.onCount++; this.handlers.push(h); },
        removeListener(_e, h) {
            this.removeCount++;
            const i = this.handlers.indexOf(h);
            if (i >= 0) this.handlers.splice(i, 1);
        }
    };
}

// ========== 1. 换会话重绑监听 + 基线重校（幻影脉冲消除） ==========
{
    const env = makeEnv();
    const es = makeEventSource();
    env.ctxHolder.eventSource = es;
    env.ctxHolder.event_types = { MESSAGE_RECEIVED: 'message_received' };
    const app = new WorldpulseApp(null, env.storage);
    // A 会话：20 楼、基线 20
    env.ctxHolder.chat = new Array(20).fill({});
    const stA = app.getState();
    stA.lastFloorCount = 20;
    app._saveState(stA);
    app.startListening();
    const hA = es.handlers[0];
    ok('A 会话启动监听（处理器绑定）', es.handlers.length === 1 && !!hA);
    // 切换到 B：全新会话（8 楼、无状态 → 修复前基线会读成 0）
    env.setSession('B');
    env.ctxHolder.chat = new Array(8).fill({});
    app.onChatChanged();
    const stB = JSON.parse(env.buckets.B.worldpulse_state_v1);
    ok('换会话后基线重校为当前楼层（0 幻影消除）', stB.lastFloorCount === 8, JSON.stringify(stB));
    ok('换会话后监听仍激活', app._listening === true);
    ok('旧监听已移除、新监听已重建', es.handlers.length === 1 && es.handlers[0] !== hA);
    es.handlers[0]();
    const stB2 = JSON.parse(env.buckets.B.worldpulse_state_v1);
    ok('重校后楼层未变不触发脉冲', stB2.queue.length === 0, JSON.stringify(stB2));
    ok('未发生脉冲处理', app._processing === false);
    // 负控制：手动把基线打回 0（模拟修复前状态）→ 应立即触发入队，证明断言有区分度
    let processCalls = 0;
    app._processQueue = () => { processCalls++; };
    stB2.lastFloorCount = 0;
    env.buckets.B.worldpulse_state_v1 = JSON.stringify(stB2);
    es.handlers[0]();
    const stB3 = JSON.parse(env.buckets.B.worldpulse_state_v1);
    ok('负控制：0 基线会入队并请求处理（断言有区分度）',
        stB3.queue.length === 1 && processCalls === 1,
        JSON.stringify({ q: stB3.queue.length, processCalls }));
    app.stopListening();
}

// ========== 2. 幂等重建 + 禁用开关语义 ==========
{
    const env = makeEnv();
    const es = makeEventSource();
    env.ctxHolder.eventSource = es;
    env.ctxHolder.event_types = { MESSAGE_RECEIVED: 'message_received' };
    const app = new WorldpulseApp(null, env.storage);
    app.startListening();
    app.startListening();
    ok('重复 startListening 不重复挂载（先停后启，处理器数=1）', es.handlers.length === 1, String(es.handlers.length));
    ok('重复调用触发先停后启（on=2 / remove=1）', es.onCount === 2 && es.removeCount === 1,
        JSON.stringify({ on: es.onCount, rm: es.removeCount }));
    // 禁用：切换会话不重建
    app.saveSettings({ enabled: false });
    app.onChatChanged();
    ok('禁用状态换会话不重建监听', app._listening === false && es.handlers.length === 0);
    // 重新启用：切换会话重建
    app.saveSettings({ enabled: true });
    app.onChatChanged();
    ok('重新启用后换会话重建监听', app._listening === true && es.handlers.length === 1);
    app.stopListening();
}

// ========== 3. 无事件源时轮询兜底：先停后启不泄漏定时器 ==========
{
    const env = makeEnv();
    const realSI = globalThis.setInterval, realCI = globalThis.clearInterval;
    let si = 0, ci = 0;
    globalThis.setInterval = () => { si++; return 424242; };
    globalThis.clearInterval = () => { ci++; };
    try {
        const app = new WorldpulseApp(null, env.storage);
        app.startListening();
        ok('无事件源时启用轮询兜底', si === 1 && app._pollTimer === 424242);
        app.startListening();
        ok('重复启动清理旧轮询（set=2 / clear=1）', si === 2 && ci === 1);
        // 换会话重绑：清旧定时器并重建
        env.setSession('B');
        app.onChatChanged();
        ok('换会话重绑清理旧轮询并重建', ci === 2 && si === 3 && app._pollTimer === 424242,
            JSON.stringify({ si, ci, t: app._pollTimer }));
        app.stopListening();
        ok('停止监听清理定时器', ci === 3 && app._pollTimer === null, JSON.stringify({ ci, t: app._pollTimer }));
    } finally {
        globalThis.setInterval = realSI;
        globalThis.clearInterval = realCI;
    }
}

// ========== 4. 入口乐观出队 + 换会话不误伤新会话队列 ==========
{
    const env = makeEnv();
    const app = new WorldpulseApp(null, env.storage);
    // A 会话：队列里两个事件
    const st0 = app.getState();
    st0.queue.push({ style: '都市日常', customPrefix: '', floorCount: 1 });
    st0.queue.push({ style: '都市日常', customPrefix: '', floorCount: 2 });
    app._saveState(st0);
    // 受控生成：挂起（模拟 LLM 数十秒）
    let release = null;
    const gate = new Promise(res => { release = res; });
    app._generate = async () => { await gate; return '平行事件正文A'; };
    const running = app._processQueue();
    // 同步断言：入口即出队（生成尚未完成）
    const stA1 = JSON.parse(env.buckets.A.worldpulse_state_v1);
    ok('入口乐观出队：生成未完成时队列已移除待处理事件',
        stA1.queue.length === 1 && stA1.queue[0].floorCount === 2, JSON.stringify(stA1.queue));
    ok('处理中标记已置位', app._processing === true);
    // 切到 B 会话：B 自己入队一个事件（模拟新会话正常脉冲）
    env.setSession('B');
    env.ctxHolder.chat = new Array(6).fill({});
    const stB = app.getState();
    stB.queue.push({ style: '财经头条', customPrefix: '', floorCount: 3 });
    app._saveState(stB);
    // 放行旧生成 → 完成时守卫应丢弃内容、且不触碰 B 队列
    release(null);
    await running;
    await sleep(120); // 留出续链 setTimeout(50) 的窗口——若误续链会消费 B 队列
    const stB1 = JSON.parse(env.buckets.B.worldpulse_state_v1);
    ok('换会话后旧链路不动新会话队列（不再误砍一条）',
        stB1.queue.length === 1 && stB1.queue[0].floorCount === 3, JSON.stringify(stB1.queue));
    ok('旧会话已生成事件不写历史（内容丢弃）', !env.buckets.A.worldpulse_history_v1);
    ok('换会话后旧链路不续链（B 队列未被旧链路消费）', !env.buckets.B.worldpulse_history_v1);
    // 回到 B 正常处理：事件不丢
    app._generate = async () => '新会话正文B';
    await app._processQueue();
    const histB = JSON.parse(env.buckets.B.worldpulse_history_v1 || '[]');
    ok('新会话事件在其会话内可正常处理（未被误砍）',
        histB.length === 1 && String(histB[0].content).includes('新会话正文B'), JSON.stringify(histB));
    ok('处理后队列清空', JSON.parse(env.buckets.B.worldpulse_state_v1).queue.length === 0);
}

// ========== 5. 接线断言（读源码文本） ==========
{
    const wsrc = fs.readFileSync(path.join(root, 'apps/worldpulse/worldpulse-app.js'), 'utf8');
    const isrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    ok('新增 onChatChanged 方法', /onChatChanged\(\) \{/.test(wsrc));
    ok('onChatChanged 内重校基线',
        /onChatChanged\(\) \{[\s\S]{0,500}st\.lastFloorCount = this\._floorCount\(\);/.test(wsrc));
    ok('startListening 先停后启', /this\.stopListening\(\);\s*\n\s*this\._listening = true;/.test(wsrc));
    ok('不再有 _listening 早退（旧监听必被清理）', !/if \(this\._listening\) return;/.test(wsrc));
    const deq = wsrc.indexOf('st.queue = st.queue.slice(1);');
    const gen = wsrc.indexOf('await this._generate(ev)');
    ok('入口乐观出队先于生成调用', deq > 0 && gen > 0 && deq < gen, `deq=${deq} gen=${gen}`);
    ok('完成时不再有二次出队（st2 已移除）', !wsrc.includes('const st2 = this.getState();'));
    const calls = (isrc.match(/worldpulseApp\??\.onChatChanged\?\.\(\)/g) || []).length;
    ok('index.js 三处接入 worldpulse 换会话重绑（换会话 + 两处清数据）', calls === 3, String(calls));
    ok('清数据路径同步重校', /clearCurrentData\(\);[\s\S]{0,900}worldpulseApp\?\.onChatChanged/.test(isrc));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);