// tests/system-v3213.test.mjs — F-1 替代轴落地：回滚影响的可见性提升（v3.11.0）
//
//   本版把 v3.9.0 取证轮留下的**有读数支持的替代轴**做出来：在删楼 / 翻页 / 重生成**之前**，
//   把「这次动作会让哪些域各丢几条」在下游自己的数据上算一遍并呈现（**只呈现、不执行**）。
//   真源 `config/rollback-preview.js` + 诊断面接线。
//
//   ★ 本仓的老账（写进判据，防止再犯）：
//     ① **读不到 ≠ 0 条** —— `absent`（读不到）与 `zero`（真的是 0 条）处置相反，
//        混起来就会出现「预览说没影响、用户放心删、实际那个域压根没被读到」。
//     ② **读数不完整要说出来** —— 未加载的部分只能算下界（`partial`），
//        绝不静默给出一个偏低但看起来完整的数字。
//     ③ **缺失不得兜底成 0** —— `Number(null) === 0`，直接 Number 化会把「没给楼层」
//        静默变成「第 0 楼」。
//     ④ **同一口径只许一份实现** —— 预览面的谓词必须与真回滚逐字同源；
//        文案的唯一实现在真源，消费侧只转发。
//     ⑤ **只算不写** —— 预览面不得调任何会落盘的出口（懒加载链会补 id / 改状态 / 落盘）。
//     ⑥ **负控制须打在真源码上** —— 破坏必须落在真文件文本、判据在破坏副本上重跑。
//
//   覆盖：
//     A 真源五域谓词与真实现同源（含短信域的 conversations 形状陷阱）
//     B 四态 + no-floor（含 null / '' / undefined 不得兜底成 0）
//     C 懒加载纪律（不写 / partial 必带 note）
//     D 取数口唯一 + 归因四档 + 楼层读数
//     E 诊断面接线（取数口在内核、视图只转发、真建卡）
//     F 真源码破坏负控制（破坏落真文件文本 → 同款真判据必须转红）
//     G 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RP = await import('../config/rollback-preview.js');
const DD = await import('../apps/diagnose/diagnose-data.js');
/* ── 五域夹具：每域给「该楼层前 / 该楼层 / 该楼层后 / 无标记」四种种子 ── */
const msg = (floor, tagged) => ({ fromMainChatTag: tagged !== false, tavernMessageIndex: floor });
function smsStore() {
    return [{ name: '甲', messages: [msg(0), msg(3), msg(5), { fromMainChatTag: false, tavernMessageIndex: 5 }] },
        { name: '乙', messages: [msg(4), msg(7)] }];
}
function flatStore() {
    return [msg(0), msg(3), msg(5), { fromMainChatTag: false, tavernMessageIndex: 5 }, { tavernMessageIndex: null }];
}
function bucketStore(loadedIds, totalChats) {
    const buckets = { c1: [msg(0), msg(3)], c2: [msg(4), msg(9)], c3: [msg(3)] };
    return { buckets, loadedIds, totalChats };
}
function fullStore() {
    return { sms: smsStore(), wechatMessages: bucketStore(['c1', 'c2', 'c3'], 3),
        wechatMoments: flatStore(), walletTransactions: flatStore(), taskProgress: [msg(0), msg(3), msg(5)] };
}
/* ══════════ A ── 真源五域谓词与真实现同源 ══════════ */
test('A1 回滚语义（及之后）逐域条数与真实现谓词一致', () => {
    const pv = RP.previewRollback(fullStore(), 3, { exact: false });
    assert.equal(pv.floorOk, true);
    const by = {};
    for (const d of pv.domains) by[d.id] = d;
    assert.equal(by.sms.count, 4, '短信：会话套消息 —— 甲桶 3/5、乙桶 4/7，floor>=3 且带标记的共 4 条（未标记那条不计）');
    assert.equal(by.sms.state, 'hit');
    assert.equal(by.wechatMessages.count, 4, '微信正文：c1 桶 1 条 + c2 桶 2 条 + c3 桶 1 条（会话分桶 + 加载标记）');
    assert.equal(by.wechatMoments.count, 2, '朋友圈动态：flat 里 3/5');
    assert.equal(by.walletTransactions.count, 2, '钱包流水：flat 里 3/5');
    assert.equal(by.taskProgress.count, 2, '任务进度：**无正文标记**，只按楼层 ⇒ 3/5 两条');
    assert.equal(pv.total, 14, '4 + 4 + 2 + 2 + 2（逐域同源谓词下的确定性读数）');
    assert.equal(pv.readable, 5, '五域都可读');
});
test('A2 编辑重放语义（正好该楼）与回滚语义给出不同读数', () => {
    const st = fullStore();
    const rb = RP.previewRollback(st, 3, { exact: false });
    const re = RP.previewRollback(st, 3, { exact: true });
    assert.equal(re.exact, true);
    assert.equal(re.floorOk, true);
    assert.equal(re.total, 6, '正好该楼：短信 1 + 微信正文 2（c1 / c3 各一条）+ 朋友圈 1 + 钱包 1 + 任务 1');
    assert.notEqual(re.total, rb.total, '★ 两种语义读数必须不同形（混成一格会给出方向相反的建议）');
    assert.ok(RP.rollbackPreviewLine(re).indexOf('正好该楼') >= 0, '文案必须写明是哪种语义');
    assert.ok(RP.rollbackPreviewLine(rb).indexOf('及之后') >= 0, '文案必须写明是哪种语义');
});
test('A3 ★ 短信域的形状陷阱：按扁平列表数会得到「漂亮的假零」', () => {
    /* 会话对象自身没有 fromMainChatTag ⇒ 若把它当扁平 message 列表数，读数恒 0。 */
    const flat = RP.previewRollback({ sms: smsStore() }, 3, { exact: false });
    assert.equal(flat.domains[0].id, 'sms');
    assert.notEqual(flat.domains[0].count, 0, '★ 必须是 4 而不是 0（0 就是「预览说不会丢、真回滚清掉一串」）');
    assert.equal(flat.domains[0].count, 4, '甲桶 3/5 + 乙桶 4/7');
});
test('A4 只报条数、不报金额（钱包流水域不得带出金额字段）', () => {
    const pv = RP.previewRollback(fullStore(), 3, { exact: false });
    const w = pv.domains.find((d) => d.id === 'walletTransactions');
    assert.equal(typeof w.count, 'number');
    assert.equal('amount' in w, false, '★ 不得预演副作用（报金额要重算余额）');
    assert.equal(/\d+\.\d{2}/.test(JSON.stringify(w)), false, '域读数不得出现金额形数字');
});
/* ══════════ B ── 四态 + no-floor ══════════ */
test('B1 四态各自可达且互不同形', () => {
    const st = { sms: smsStore(), wechatMoments: [], walletTransactions: flatStore(), taskProgress: null, wechatMessages: undefined };
    const pv = RP.previewRollback(st, 3, { exact: false });
    const by = {};
    for (const d of pv.domains) by[d.id] = d.state;
    assert.equal(by.sms, 'hit');
    assert.equal(by.wechatMoments, 'zero', '空数组 = 读到了但真的是 0 条');
    assert.equal(by.walletTransactions, 'hit');
    assert.equal(by.taskProgress, 'absent', 'null = 读不到');
    assert.equal(by.wechatMessages, 'absent', 'undefined = 读不到');
    const rows = RP.rollbackPreviewTable(pv);
    const t = {};
    for (const r of rows) t[r.id] = r.text;
    assert.ok(/读不到/.test(t.taskProgress) && /不等于 0 条/.test(t.taskProgress), 'absent 文案必须与 zero 不同形');
    assert.ok(/^0 条/.test(t.wechatMoments), 'zero 文案：0 条（这一楼不影响它）');
    assert.notEqual(t.taskProgress, t.wechatMoments, '★ 两态文案不得同形');
});
test('B2 ★ 楼层缺失不得兜底成 0（Number(null) === 0）', () => {
    for (const bad of [null, undefined, '']) {
        const pv = RP.previewRollback(fullStore(), bad, { exact: false });
        assert.equal(pv.floorOk, false, '★ ' + String(bad) + ' ⇒ 不可算');
        assert.equal(pv.floor, null);
        assert.equal(pv.total, null, '★ 不得退化成 0 条（0 条是个结论）');
        assert.ok(pv.domains.every((d) => d.state === 'no-floor'), '各域都该 no-floor');
        assert.ok(/楼层不可算/.test(RP.rollbackPreviewLine(pv)));
    }
    /* 0 是**合法楼层**（0 基，与 SillyTavern 一致） */
    const zero = RP.previewRollback(fullStore(), 0, { exact: false });
    assert.equal(zero.floorOk, true, '0 必须仍可算');
    assert.equal(zero.floor, 0);
    assert.ok(zero.domains[0].state !== 'no-floor');
    /* NaN / 非数字串同样不可算 */
    assert.equal(RP.previewRollback(fullStore(), 'abc').floorOk, false);
    assert.equal(RP.previewRollback(fullStore(), NaN).floorOk, false);
});
test('B3 ★ 不可读的域不得被 total 当成 0 条加进去', () => {
    const st = { sms: smsStore(), wechatMessages: null, wechatMoments: null, walletTransactions: null, taskProgress: null };
    const pv = RP.previewRollback(st, 3, { exact: false });
    assert.equal(pv.total, 4, '只有短信域可读 ⇒ total 只算它（实测 ' + pv.total + '）');
    assert.equal(pv.readable, 1);
    assert.equal(pv.allAbsent, false);
    const all = RP.previewRollback({}, 3, { exact: false });
    assert.equal(all.allAbsent, true, '五域全读不到 ⇒ allAbsent');
    assert.ok(/五个域全部读不到/.test(RP.rollbackPreviewLine(all)), '必须显式说「看不清」而不是「没影响」');
});
/* ══════════ C ── 懒加载纪律 ══════════ */
test('C1 ★ 未标记已加载的会话只报下界（partial），且必带 note', () => {
    const pv = RP.previewRollback({ wechatMessages: bucketStore(['c1'], 3) }, 3, { exact: false });
    const d = pv.domains.find((x) => x.id === 'wechatMessages');
    assert.equal(d.state, 'partial', '★ 有未加载会话 ⇒ 不得报成完整的 hit');
    assert.equal(d.count, 1, '只算已加载的 c1（1 条命中）');
    assert.ok(d.note && d.note.length > 0, '★ partial 必带说明');
    assert.ok(/2 个会话尚未加载/.test(d.note), 'note 必须给出未加载数（实测 ' + d.note + '）');
    assert.equal(pv.partial, 1, 'partial 计数必须带出');
    const rows = RP.rollbackPreviewTable(pv);
    const row = rows.find((r) => r.id === 'wechatMessages');
    assert.ok(/至少 1 条/.test(row.text) && /下界/.test(row.text), '★ 文案必须说「至少」而不是「就是这些」');
    const line = RP.rollbackPreviewLine(pv);
    assert.ok(/下界/.test(line), '★ 一行读数必须写出下界');
    assert.equal(/(^|[^至少])共 1 条/.test(line), false, '不得把下界说成确定值');
});
test('C2 全部会话都已加载 ⇒ 回到完整读数（partial 不是永久态）', () => {
    const pv = RP.previewRollback({ wechatMessages: bucketStore(['c1', 'c2', 'c3'], 3) }, 3, { exact: false });
    const d = pv.domains.find((x) => x.id === 'wechatMessages');
    assert.equal(d.state, 'hit');
    assert.equal(d.count, 4, 'c1 一条 + c2 两条（4/9 都在范围内）+ c3 一条');
    assert.equal(pv.partial, 0);
});
test('C3 ★ 真源模块不得调按会话取消息的出口（它会补 id / 改状态 / 落盘）', () => {
    const src = readRel('config/rollback-preview.js');
    /* 剥注释后再查（注释里讨论这条纪律是允许且必要的） */
    const code = src.split('\n')
        .filter((l) => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')); })
        .join('\n');
    assert.equal(/\.getMessages\s*\(/.test(code), false, '★ 预览面不得调用按会话取消息的出口');
    assert.equal(/\.saveData\s*\(/.test(code), false, '★ 预览面不得触任何落盘出口');
    assert.equal(/localStorage/.test(code), false, '★ 预览面不得碰 localStorage');
    /* ★ `sources.push` 是本模块**自己新建**的归因数组，合法；要挡的是对**取到的数据**
     *   做写操作（那才是「只算不写」的反面）。 */
    assert.equal(/src\[[^\]]+\]\.(push|splice|pop|shift|unshift|sort|reverse|fill)\s*\(/.test(code), false,
        '★ 预览面不得改写取到的域数据');
    assert.equal(/buckets\[[^\]]+\]\s*=/.test(code), false, '★ 预览面不得写回桶');
    /* 读取面必须是「内存桶 + 加载标记表」 */
    assert.ok(/_messagesLoaded/.test(code), '必须用加载标记表判定已加载');
    assert.ok(/data\.messages/.test(code), '必须只读内存桶');
});
test('C4 ★ 导出面上不存在任何执行出口（这条轴的设计，不是「还没实现」）', () => {
    const names = Object.keys(RP).filter((k) => k !== 'default');
    assert.deepEqual(names.map((n) => typeof RP[n]).filter((t) => t !== 'function'), [], '具名导出都必须可用');
    /* 判据面：把导出面当**白名单**查，而不是查「有没有执行动词前缀」——
     *   本轴自己的出口就叫 `rollbackPreview*`，按前缀黑名单会误伤（它只算不执行）；
     *   而白名单能把「将来顺手导出个 `rollbackSmsToFloor`」这类回归直接钉住。 */
    const READ_ONLY_NAMES = new Set(['currentFloorOf', 'previewRollback', 'readRollbackStores',
        'rollbackPreviewFace', 'rollbackPreviewLine', 'rollbackPreviewTable']);
    for (const n of names) assert.ok(READ_ONLY_NAMES.has(n), '★ 导出面出现非读数 / 非呈现名：' + n);
    const dfltFace = RP.default || {};
    for (const k of Object.keys(dfltFace)) assert.ok(READ_ONLY_NAMES.has(k), '★ default 面出现非读数 / 非呈现名：' + k);
    const src = readRel('config/rollback-preview.js');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    /* 末条同样不能按前缀黑名单查：本轴自己的出口就叫 `rollbackPreview*`。
     *   改成把真源里**每个** `export function <名字>` 逐个对白名单 —— 这样
     *   「将来顺手导出 rollbackSmsToFloor / applyRollback」会被直接钉住，且不误伤式样名。 */
    const decls = (code.match(/export\s+function\s+([A-Za-z_$][\w$]*)/g) || [])
        .map((x) => x.replace(/^export\s+function\s+/, ''));
    assert.ok(decls.length >= 6, '真源具名导出须在场（实测 ' + decls.length + '）');
    for (const n of decls) assert.ok(READ_ONLY_NAMES.has(n), '★ 真源导出的函数不是读数出口：' + n);
    assert.equal(/export\s+(let|var)\s+|export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(\(|function)/.test(code), false,
        '★ 真源不得导出可变绑定 / 匿名执行体');
});
/* ══════════ D ── 取数口唯一 + 归因 + 楼层 ══════════ */
test('D1 ★ 五域取数口唯一：全仓只许真源一处读这些出口', () => {
    const files = [];
    (function walk(dir) {
        for (const n of fs.readdirSync(dir)) {
            const abs = path.join(dir, n);
            if (fs.statSync(abs).isDirectory()) walk(abs);
            else if (n.endsWith('.js')) files.push(path.relative(ROOT, abs).split(path.sep).join('/'));
        }
    })(path.join(ROOT, 'apps'));
    for (const n of fs.readdirSync(path.join(ROOT, 'config'))) {
        if (n.endsWith('.js')) files.push('config/' + n);
    }
    const sites = { 'getSmsConversations': [], 'getWalletTransactions': [], 'getMoments': [] };
    for (const rel of files) {
        const src = readRel(rel);
        for (const k of Object.keys(sites)) if (src.includes(k)) sites[k].push(rel);
    }
    for (const [k, list] of Object.entries(sites)) {
        assert.equal(list.indexOf('config/rollback-preview.js') >= 0, true, k + ' 的取数口必须在真源（实测 ' + list.join(',') + '）');
    }
    /* 短信读出口（`getSmsConversations`）与另外两个不同：它是通话数据层的**持有方出口**，
     *   全仓历史上多处使用（拦截链、短信视图、生成链、微信侧兜底读取都在用它），
     *   本版既不可能也不应该去收敛它们。本版能守、也必须守的是**不新增取数口**：
     *   预览面的取数口唯一落在真源，本版新增的消费侧（诊断面）必须走真源转发，
     *   不得自己再摸一遍宿主出口 —— 下面这条就是它的落点。 */
    for (const rel of ['apps/diagnose/diagnose-data.js', 'apps/diagnose/diagnose-view.js']) {
        const s = readRel(rel);
        for (const k of Object.keys(sites).concat(['_messagesLoaded'])) {
            assert.equal(s.includes(k), false, '★ 诊断面不得自开取数口：' + rel + ' 命中 ' + k);
        }
    }
});
test('D2 归因四档：ok / no-host / face-absent / thrown', () => {
    const noHost = RP.readRollbackStores({});
    assert.equal(noHost.host, false);
    assert.ok(noHost.sources.every((s) => s.state === 'no-host'), '无宿主 ⇒ 全 no-host');
    assert.equal(noHost.sms, null);
    /* 有宿主但这一层没给 */
    const faceAbsent = RP.readRollbackStores({ VirtualPhone: {} });
    assert.equal(faceAbsent.host, true);
    assert.ok(faceAbsent.sources.every((s) => s.state === 'face-absent'), '实测 ' + JSON.stringify(faceAbsent.sources.map((s) => s.state)));
    /* 真取到数 */
    const win = { VirtualPhone: { phoneApp: { phoneCallData: { getSmsConversations: () => smsStore() } } } };
    const ok = RP.readRollbackStores(win);
    assert.equal(ok.sources.find((s) => s.id === 'sms').state, 'ok');
    assert.equal(Array.isArray(ok.sms), true);
    /* 出口抛错 ⇒ thrown（不抛出去） */
    const thrownWin = { VirtualPhone: { phoneApp: { phoneCallData: { getSmsConversations() { throw new Error('boom'); } } } } };
    const th = RP.readRollbackStores(thrownWin);
    assert.equal(th.sources.find((s) => s.id === 'sms').state, 'thrown');
    assert.equal(th.sms, null);
});
test('D3 ★ 取数口必须真调宿主出口（防「桩没被调」的假绿）', () => {
    let calls = 0;
    const win = { VirtualPhone: { phoneApp: { phoneCallData: { getSmsConversations() { calls += 1; return smsStore(); } } } } };
    RP.readRollbackStores(win);
    assert.equal(calls, 1, '★ 必须真调用宿主取数口（实测 ' + calls + ' 次）');
    /* 微信三域共用同一实例：App 持有的优先 */
    let used = '';
    const wd = { data: { messages: {}, chats: [] }, _messagesLoaded: {},
        getMoments() { used = 'app'; return []; }, getWalletTransactions() { return []; } };
    const cached = { data: { messages: {}, chats: [] }, _messagesLoaded: {}, getMoments() { used = 'cached'; return []; } };
    const r = RP.readRollbackStores({ VirtualPhone: { wechatApp: { wechatData: wd }, cachedWechatData: cached } });
    assert.equal(used, 'app', 'App 持有的实例优先（与全仓同一条解析顺序）');
    assert.equal(r.sources.find((s) => s.id === 'wechatMoments').state, 'ok');
});
test('D4 ★ 当前楼层读数：空会话返回 null（不得兜底成 0）', () => {
    assert.equal(RP.currentFloorOf({}), null, '无宿主 ⇒ null');
    const mk = (n) => ({ SillyTavern: { getContext: () => ({ chat: new Array(n).fill({}) }) } });
    assert.equal(RP.currentFloorOf(mk(5)), 4, '0 基（chat.length - 1）');
    assert.equal(RP.currentFloorOf(mk(1)), 0, '★ 0 是合法楼层');
    assert.equal(RP.currentFloorOf(mk(0)), null, '★ 空会话 ⇒ null，不得凭空造出一个「可作废的楼层」');
    const thrown = { SillyTavern: { getContext() { throw new Error('boom'); } } };
    assert.equal(RP.currentFloorOf(thrown), null, '宿主抛错 ⇒ null（不抛出去）');
});
test('D5 rollbackPreviewFace：两种语义一次取齐，且读数与 previewRollback 同源', () => {
    const win = { SillyTavern: { getContext: () => ({ chat: new Array(6).fill({}) }) },
        VirtualPhone: { phoneApp: { phoneCallData: { getSmsConversations: () => smsStore() } } } };
    const f = RP.rollbackPreviewFace(win);
    assert.equal(f.floorOk, true);
    assert.equal(f.floor, 5);
    assert.equal(f.rollback.total, RP.previewRollback(RP.readRollbackStores(win), 5, { exact: false }).total,
        '★ 同一入参下两种调用路径的读数必须逐值一致（不得各算一遍）');
    assert.equal(f.replay.exact, true);
    assert.ok(Array.isArray(f.sources) && f.sources.length === 5, '五域归因齐全');
    assert.equal(f.readings, 1, '只有短信域读得到（实测 ' + f.readings + '）');
});
/* ══════════ E ── 诊断面接线 ══════════ */
test('E1 诊断内核：取数在内核、文案只转发（同一口径只许一份实现）', () => {
    const src = readRel('apps/diagnose/diagnose-data.js');
    assert.ok(/rollbackPreviewFace\(w\)/.test(src), '★ 取数必须在内核（视图不得自己摸宿主）');
    assert.ok(/return\s*\{[^}]*rollbackPreview: previewSc/.test(src), '读数必须进 collectDiagnose 返回体');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    assert.equal(/fromMainChatTag/.test(code), false, '★ 内核不得自写谓词（必须走真源）');
    assert.equal(/tavernMessageIndex/.test(code), false, '★ 内核不得自判楼层');
    /* 两条转发出口与真源逐字同源 */
    const pv = RP.previewRollback(fullStore(), 3, { exact: false });
    assert.equal(DD.rollbackPreviewFaceText(pv), RP.rollbackPreviewLine(pv), '文案逐字取自真源');
    assert.deepEqual(DD.rollbackPreviewRows(pv), RP.rollbackPreviewTable(pv), '逐域明细逐值取自真源');
    const dflt = DD.default || null;
    if (dflt) assert.equal(typeof dflt.rollbackPreviewFaceText, 'function', 'default 出口也要带（漏了会静默 undefined）');
});
test('E2 collectDiagnose 真建读数（无宿主时四态仍必须可分辨）', () => {
    const pkg = DD.collectDiagnose(null, null);
    assert.ok(pkg.rollbackPreview, '★ 无宿主也必须给出读数面（缺席 ≠ 不建卡）');
    const f = pkg.rollbackPreview;
    assert.equal(f.host, false);
    assert.equal(f.floorOk, false, '无宿主 ⇒ 没楼层可算');
    assert.equal(f.rollback.floorOk, false, '★ 修前疑似：Number(null)===0 会把这里变成 floor 0 / 五域 zero');
    assert.equal(f.rollback.total, null, '★ 不得退化成「0 条影响」');
    assert.ok(f.sources.every((s) => s.state === 'no-host'));
    assert.ok(/楼层不可算/.test(DD.rollbackPreviewFaceText(f.rollback)), '文案必须说清是「没楼层」而不是「没影响」');
});
test('E3 诊断视图：真建卡 + 两种语义分列 + 四态不同色', () => {
    const src = readRel('apps/diagnose/diagnose-view.js');
    assert.ok(/_rollbackPreviewHtml\(pkg\)/.test(src), '★ 必须真建卡');
    assert.ok(/rollbackPreviewFaceText\(pv\.rollback\)/.test(src) && /rollbackPreviewFaceText\(pv\.replay\)/.test(src),
        '★ 两种语义必须分列（混成一格会给出方向相反的建议）');
    assert.ok(/rollbackPreviewRows\(pv\.rollback\)/.test(src), '逐域明细必须取自真源');
    assert.ok(/取数归因/.test(src), '归因必须可见');
    assert.ok(/只算不执行/.test(src), '口径纪律必须写在卡上');
    assert.ok(/不会.{0,4}替你回滚/.test(src), '必须写明不会执行');
    /* 视图不得自己数条数 */
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    assert.equal(/fromMainChatTag/.test(code), false, '★ 视图不得自写谓词');
});
test('E4 视图消费侧不得自写归因文案表（第九道门 J4 同族）', () => {
    const code = readRel('apps/diagnose/diagnose-view.js').split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    /* 「同一口径只许一份实现」在视图侧的落点：归因档**不得被视图当成判断依据** ——
     *   ① 不得出现 `.state === '<档>'` 这类自己判档的比较；
     *   ② 不得为归因档建中文映射表（那是第二份文案实现）。
     *   允许的形态：把数据面给的归因值**原样**贴出去（`s.id + '=' + s.state`）。
     *   说明：`_rollbackPreviewHtml` 的**注释**里点过这些档名（讲纪律的地方），
     *   上面的 filter 已把注释剥掉 —— 这条判据查的是「有没有第二份实现」，不是「有没有提过这个词」。
     *   注意别误伤隔壁那条轴：`s.sourceState === 'thrown'` 是桥面来源态，不是本卡的取数归因。 */
    for (const t of ['no-host', 'face-absent', 'thrown']) {
        assert.equal(new RegExp('\\.state\\s*===\\s*[\'"]' + t + '[\'"]').test(code), false,
            '★ 视图不得自己判归因档 ' + t + '（应逐值取自真源）');
        assert.equal(new RegExp('[\'"]' + t + '[\'"]\\s*:').test(code), false,
            '★ 视图不得为归因档建映射表 ' + t);
    }
    assert.ok(/s\.state/.test(code), '归因值必须来自数据面（原样贴出），而不是视图手写');
});
test('E5 卡位次序：预览卡在「存档健康」之前（先看范围，再看时代）', () => {
    const src = readRel('apps/diagnose/diagnose-view.js');
    const iPrev = src.indexOf('<h3>回滚影响预览');
    const iStore = src.indexOf('<h3>存档健康</h3>');
    assert.ok(iPrev > 0 && iStore > 0, '两张卡都必须在场');
    assert.ok(iPrev < iStore, '★ 次序错了：范围（这一次动作）应先于时代（这份存档）');
});
/* ══════════ F ── 负控制（真源码破坏 → 破坏副本 → 同款真判据必须转红） ══════════ */
function sandbox(relDirs) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3213_'));
    const copy = (src, dst) => {
        fs.mkdirSync(dst, { recursive: true });
        for (const name of fs.readdirSync(src)) {
            const s = path.join(src, name);
            const d = path.join(dst, name);
            if (fs.statSync(s).isDirectory()) copy(s, d);
            else if (name.endsWith('.js')) fs.copyFileSync(s, d);
        }
    };
    for (const rel of relDirs) copy(path.join(ROOT, rel), path.join(root, rel));
    return root;
}
function damage(root, rel, anchor, replacement) {
    const p = path.join(root, rel);
    const txt = fs.readFileSync(p, 'utf8');
    const hits = txt.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(p, txt.split(anchor).join(replacement));
}
test('F1 让楼层缺失兜底成 0 ⇒ 同款「不得兜底」判据必须转红', () => {
    /* 破坏落在**真源码文本**上：摘掉「先把 null / undefined / '' 归一为 NaN」这一步，
     *   `floorNum` 于是退化成裸 `Number()` ⇒ `Number(null) === 0`、`Number('') === 0`
     *   把「没给楼层」变成「第 0 楼」，并给出一份「第 0 楼及之后」的漂亮读数。 */
    const root = sandbox(['config']);
    const anchor = "    if (raw === null || raw === undefined || raw === '') return NaN;\n";
    damage(root, 'config/rollback-preview.js', anchor, '');
    const brokenSrc = fs.readFileSync(path.join(root, 'config/rollback-preview.js'), 'utf8');
    assert.equal(brokenSrc.includes(anchor), false, '★ 破坏必须真的发生（摘除后锚点不得残留）');
    return import(pathToFileURL(path.join(root, 'config/rollback-preview.js')).href + '?t=' + Date.now()).then((M) => {
        for (const bad of [null, '']) {
            const pv = M.previewRollback(fullStore(), bad, { exact: false });
            assert.equal(pv.floorOk, true, '★ 破坏后 ' + String(bad) + ' 被兜底成「第 0 楼」⇒ 同款判据转红');
            assert.equal(pv.floor, 0, '★ 没给楼层被伪装成「第 0 楼」');
        }
        /* 如实记录破坏面：`Number(undefined)` 是 NaN，故这一形态在破坏后**仍**不可算。 */
        assert.equal(M.previewRollback(fullStore(), undefined, { exact: false }).floorOk, false,
            '注：undefined 形态在破坏后仍不可算（Number(undefined) 是 NaN，破坏面只覆盖 null / 空串）');
        const pv = M.previewRollback(fullStore(), null, { exact: false });
        assert.ok(pv.domains.every((d) => d.state !== 'no-floor'), '★ 五域都不再是 no-floor（漂亮的假读数）');
        assert.ok(pv.total > 0, '★ 并给出一串非零条数（方向与真相相反：真相是「范围未知」）');
        const live = RP.previewRollback(fullStore(), null, { exact: false });
        assert.equal(live.floorOk, false, '对照：真源码下 null ⇒ 不可算');
        assert.ok(live.domains.every((d) => d.state === 'no-floor'), '对照：真源码下五域都是 no-floor');
        assert.equal(live.total, null, '对照：真源码下 total 是 null，不是 0');
    });
});
test('F2 ★ 让预览面去调懒加载出口 ⇒ 同款「只算不写」判据必须转红', () => {
    const root = sandbox(['config']);
    damage(root, 'config/rollback-preview.js', "    const w = hostWindow(win);\n    const vp = (w && w.VirtualPhone) || null;\n",
        "    const w = hostWindow(win);\n    const vp = (w && w.VirtualPhone) || null;\n    if (vp && vp.wechatApp && vp.wechatApp.wechatData) vp.wechatApp.wechatData.getMessages('c1');\n");
    const live = readRel('config/rollback-preview.js');
    const code = live.split('\n').filter((l) => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')); }).join('\n');
    assert.equal(/\.getMessages\s*\(/.test(code), false, '对照：真源码下该纪律成立');
    return import(pathToFileURL(path.join(root, 'config/rollback-preview.js')).href + '?t=' + Date.now()).then((M) => {
        assert.equal(typeof M.readRollbackStores, 'function', '破坏副本仍可加载');
        const src = fs.readFileSync(path.join(root, 'config/rollback-preview.js'), 'utf8');
        const broken = src.split('\n').filter((l) => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')); }).join('\n');
        assert.equal(/\.getMessages\s*\(/.test(broken), true, '★ 破坏后调用式在场 ⇒ 同款判据（不得调）转红');
    });
});
test('F3 ★ 让 absent 退化成 0 条 ⇒ 同款「读不到 ≠ 0」判据必须转红', () => {
    /* 同一族缺陷有两个真入口，两处都要打，判据才不会只守住一半：
     *   ① **取数返回**：`countByFloor` 对「非数组且无 messages」本该返回 null（读不到），
     *      破坏成返回 0 ⇒ 「读不到」直接被数值化成「0 条」；
     *   ② **状态判定**：`n === null ⇒ absent` 是「读不到」唯一的出口，破坏成 zero。 */
    const root = sandbox(['config']);
    damage(root, 'config/rollback-preview.js', '    if (!list) return null;\n', '    if (!list) return 0;\n');
    return import(pathToFileURL(path.join(root, 'config/rollback-preview.js')).href + '?t=' + Date.now()).then((M) => {
        const pv = M.previewRollback({ wechatMoments: null }, 3, { exact: false });
        assert.equal(pv.domains[2].state, 'zero', '★ 读不到被伪装成「真的是 0 条」⇒ 同款判据（必须 absent）转红');
        assert.equal(pv.allAbsent, false, '★ 全读不到却报 allAbsent:false');
        assert.equal(pv.total, 0, '★ 合计给出「0 条」这个方向相反的结论');
        const live = RP.previewRollback({ wechatMoments: null }, 3, { exact: false });
        assert.equal(live.domains[2].state, 'absent', '对照：真源码下 absent 不被顶替');
        assert.equal(live.total, 0, '对照：真源码下该域不可读，也不被算进 total');
        /* ② */
        const root2 = sandbox(['config']);
        damage(root2, 'config/rollback-preview.js', "        if (n === null) state = 'absent';\n",
            "        if (n === null) state = 'zero';\n");
        return import(pathToFileURL(path.join(root2, 'config/rollback-preview.js')).href + '?t=' + Date.now()).then((M2) => {
            const pv2 = M2.previewRollback({ sms: null }, 3, { exact: false });
            assert.equal(pv2.domains[0].state, 'zero', '★ 判据出口被改 ⇒ absent 不再可达 ⇒ 同款判据转红');
            assert.equal(pv2.allAbsent, false, '★ 读不到被算成「0 条」后 allAbsent 也失真');
            const live2 = RP.previewRollback({ sms: null }, 3, { exact: false });
            assert.equal(live2.domains[0].state, 'absent', '对照：真源码下读不到如实 absent');
        });
    });
});
test('F4 ★ 让 partial 退化成完整读数 ⇒ 同款「下界要说出来」判据必须转红', () => {
    const root = sandbox(['config']);
    damage(root, 'config/rollback-preview.js', '        ? { count: n, partial: true, note: ', '        ? { count: n, partial: false, note: ');
    return import(pathToFileURL(path.join(root, 'config/rollback-preview.js')).href + '?t=' + Date.now()).then((M) => {
        const pv = M.previewRollback({ wechatMessages: bucketStore(['c1'], 3) }, 3, { exact: false });
        const d = pv.domains.find((x) => x.id === 'wechatMessages');
        assert.equal(d.state, 'hit', '★ 破坏后下界被当成完整读数 ⇒ 同款判据（必须 partial）转红');
        assert.equal(pv.partial, 0);
        const live = RP.previewRollback({ wechatMessages: bucketStore(['c1'], 3) }, 3, { exact: false });
        assert.equal(live.partial, 1, '对照：真源码下如实 partial');
    });
});
/* ══════════ G ── 版本锚 ══════════ */
test('G1 ★ 版本五源同源为 3.11.0，且当版条目非空', () => {
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const idx = readRel('index.js');
    assert.equal(man.version, '3.11.0', 'manifest 版本');
    assert.equal(pkg.version, '3.11.0', 'package 版本');
    assert.equal(log.latest, '3.11.0', 'update-log latest');
    assert.equal(Object.keys(log.versions)[0], '3.11.0', 'versions 首键（仓内判据约定）');
    assert.ok(log.versions['3.11.0'], 'update-log 必须有当版条目');
    assert.ok(log.versions['3.11.0'].items.length >= 4, '当版条目至少 4 条');
    assert.ok(/const ST_PHONE_VERSION = '3\.11\.0'/.test(idx), '入口版本常量');
    assert.ok(/回滚影响|只算不执行|可见性/.test(idx), '内置公告须提到本版主题（供 App 内更新弹窗）');
});
test('G2 ★ 弹窗 items 与 update-log 逐字同源', () => {
    const idx = readRel('index.js');
    const log = JSON.parse(readRel('update-log.json'));
    const entry = log.versions[log.latest];
    const m = idx.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(m, 'ST_PHONE_CURRENT_UPDATE 可提取');
    for (const item of entry.items) {
        assert.ok(m[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 20) + '…');
    }
    assert.match(m[0], new RegExp('date: "' + entry.date + '"'));
    assert.ok(m[0].includes('版本升至 3.11.0（五源同源）'), '落地行必须带版本升级声明');
});
test('G3 当版条目必须如实记录「交棒改写」与「自己抓到的缺陷」', () => {
    const log = JSON.parse(readRel('update-log.json'));
    const txt = log.versions['3.11.0'].items.join(' ');
    assert.ok(/交棒改写|主动改写/.test(txt), '必须记下对旧判据的交棒改写（而非静默通过）');
    assert.ok(/Number\(null\) === 0|兜底成 0/.test(txt), '必须记下楼层兜底缺陷');
    assert.ok(/只算不写/.test(txt) && /懒加载/.test(txt), '必须记下懒加载纪律与代价');
    assert.ok(/substring|子串匹配|块注释行不跳|散文/.test(txt), '必须记下「注释不得写函数名」的判据面纪律');
});
