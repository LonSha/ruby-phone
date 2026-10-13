/* ========================================================
 * tests/system-v4050.test.mjs -- [v4.05.0 · 第三期 E 包手机侧第六项 R3-X9]
 *   地点探索与场景漫游(清单四态 / 路径三态 / 地点卡 / 出行提案)
 *
 * 【本版要证的六件事(与计划原文 R3-X9 的验收口径一一对应)】
 *   1 从当前地点选目的地**可带出已知线索** —— 线索行由内核产出,app 只搬不判;
 *   2 **未知路径标未知、不编距离** —— 出口对象里根本没有距离 / 耗时格,源码与对象两道查;
 *   3 **无地图坐标也能用列表与拓扑** —— 全部判据只喂树与链,不喂任何坐标;
 *   4 **正文或用户确认到达后才更新** —— 本版做的是「提案」:app 只派发 phone:sendToChat,
 *     不写任何地点状态(判据 C7 / C8 把这条钉成硬约束);
 *   5 **已有世界状态仍由原 owner 持有** —— 往事与约定只读镜像 calendar 的账,不新开第二个 owner;
 *   6 **读不到 ≠ 没去过** —— 清单第四态 unknown 的存在理由。
 *
 * 判据面(五组):
 *   A 结构:内核自检 / 四态四文案 / 三路由 / 上限冻结 / 零依赖边界
 *   B 行为:读不到即未知但证据优先 / 四态分组排序 / 孤儿行不隐藏 / 路径三态 /
 *           认不出即拒不就近凑 / 没有距离格 / 中段未知如实标 / 三面各自归因 / 提案三行 / 不改入参
 *   C 接线:app 层(只读镜像 + 面在不在按读到判 + 提案交给聊天 + 零地点写) /
 *           视图层(卡位置 + 两处绑定 + 详情三态) / CSS 四态 / 键登记 / 既有契约不回退
 *   D 负控制:真源码定点破坏三条口径 ⇒ 对应判据必转红
 *   E 版本锚:下限形(不锁当版读数,下一版抬版无需二次改写)
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const CORE = 'config/place-roam.js';
const APP = 'apps/place/place-app.js';
const VIEW = 'apps/place/place-view.js';
const DATA = 'apps/place/place-data.js';
const CSS = 'apps/place/place.css';
const KEYS = 'scripts/keys-audit.mjs';
const EVENTS = 'config/phone-events.js';
const core = read(CORE);
const app = read(APP);
const view = read(VIEW);
const data = read(DATA);
const css = read(CSS);
const keys = read(KEYS);
const events = read(EVENTS);
const mod = await import(path.join(ROOT, CORE));
/** 去注释后扫代码(本仓反复踩过「注释里的词被当成代码」的坑;A5 / C7 / C8 都靠它) */
/** 去注释后扫代码。**这里刻意不用正则**:转义层数一多,「去注释」这条自身就会静默失效
 *  (本版实测踩过:正则里的反斜杠被多写一层 ⇒ 注释根本没被去掉 ⇒ 注释里提一嘴 window
 *  就被当成代码命中)。改为逐字符扫描,只有 `/ *` 与 `/ /` 两种进入态。 */
const strip = (s) => {
    const src = String(s);
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const nx = src[i + 1];
        if (ch === '/' && nx === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            out += ' ';
            continue;
        }
        if (ch === '/' && nx === '/') {
            i += 2;
            while (i < src.length && src[i] !== '\n') i++;
            out += ' ';
            continue;
        }
        out += ch;
        i++;
    }
    return out;
};
const codeOf = (s) => strip(s);
/** 去注释 + 去字符串字面量(判据要「真代码」时用;字符串里的词不算代码) */
const bareOf = (s) => strip(s).replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
/* 一份共同的样品:树 + 链 + 到访 + 在场 + 往事(与内核实测同形,不额外造特例) */
const TREE = [
    { key: 'city', name: '云城', depth: 1 },
    { key: 'city/downtown', name: '老城区', depth: 2 },
    { key: 'city/downtown/cafe', name: '巷口咖啡', depth: 3, visited: true, visits: 3 },
    { key: 'city/downtown/cafe/corner', name: '临窗角落', depth: 4 },
    { key: 'city/downtown/library', name: '市图书馆', depth: 3 },
    { key: 'city/harbor', name: '港口', depth: 2 },
    { key: 'city/harbor/pier', name: '三号栈桥', depth: 3 }
];
const CHAIN = ['云城', '老城区', '巷口咖啡'];
const VISITS = [{ key: 'city/downtown/cafe', count: 3, firstFloor: 4, lastFloor: 40 },
    { key: 'city/harbor/pier', count: 1, firstFloor: 12, lastFloor: 12 }];
const sample = (extra = {}) => Object.assign({
    tree: TREE, currentChain: CHAIN, visits: VISITS,
    presence: [{ key: 'city/harbor/pier', members: ['阿岚', '小满'], atFloor: 30 }],
    notes: [{ kind: '约定', text: '在栈桥碰头', place: 'city/harbor/pier', dateKey: '2026-10-20', atFloor: 33 }]
}, extra);

/* ---------- A 结构 ---------- */
test('A1 内核自检零问题 + 出口齐备', () => {
    const r = mod.roamSelfCheck();
    assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
    for (const fn of ['normalizeRoamInputs', 'resolveCurrentChain', 'roamStateOf', 'exploreList',
        'buildRouteFrom', 'buildRoute', 'presenceAt', 'notesAt', 'roamClues',
        'buildTravelProposal', 'registerStateOf', 'registerLine', 'roamSelfCheck']) {
        assert.equal(typeof mod[fn], 'function', '缺出口:' + fn);
    }
});
test('A2 四态各有各的字样(两态同形即失败)', () => {
    const t = mod.ROAM_STATE_TEXT;
    const vals = Object.values(mod.ROAM_STATES);
    assert.equal(vals.length, 4, '必须四态');
    for (const s of vals) assert.equal(typeof t[s], 'string', '缺文案:' + s);
    assert.equal(new Set(vals.map((s) => t[s])).size, 4, '四态文案不得塌成同形');
});
test('A3 三路由在册且互异;归因词齐备且冻结', () => {
    const r = Object.values(mod.ROAM_ROUTES);
    assert.equal(new Set(r).size, 3);
    for (const need of ['ok', 'no-current', 'no-nodes', 'target-missing', 'place-unknown',
        'same-place', 'no-history-face', 'no-presence', 'no-presence-face', 'no-notes-face']) {
        assert.equal(typeof mod.ROAM_REASONS[need], 'string', '缺归因词:' + need);
    }
    assert.ok(Object.isFrozen(mod.ROAM_REASONS) && Object.isFrozen(mod.ROAM_STATES)
        && Object.isFrozen(mod.ROAM_STATE_TEXT) && Object.isFrozen(mod.ROAM_ROUTES));
});
test('A4 上限冻结,且步骤上限是个正数', () => {
    assert.ok(Object.isFrozen(mod.ROAM_LIMITS));
    for (const k of ['nodes', 'steps', 'clues', 'presence', 'line']) {
        assert.equal(typeof mod.ROAM_LIMITS[k], 'number', '缺上限:' + k);
        assert.ok(mod.ROAM_LIMITS[k] >= 1, '上限须为正:' + k);
    }
});
test('A5 零依赖零宿主边界(只 import 一处,代码里无 window / storage / eval)', () => {
    const c = codeOf(core);
    const imports = core.match(/^import .*$/gm) || [];
    assert.equal(imports.length, 1, '内核只许 import 一处,实测 ' + imports.length);
    assert.ok(imports[0].includes("'./num-gate.js'"), '那唯一一处必须是 num-gate:' + imports[0]);
    for (const bad of ['window', 'document', 'localStorage', 'sessionStorage', 'fetch(', 'eval(',
        'new Function', 'setTimeout', 'srcdoc', 'require(']) {
        assert.equal(c.indexOf(bad), -1, '内核代码里不得出现 ' + bad);
    }
});

/* ---------- B 行为 ---------- */
test('B1 没有到访史面 ⇒ 每一处都标未知(读不到不是「没去过」)', () => {
    /* 样品刻意用「不带 visited 标记」的同一棵树:这样才真的落在「读不到」这一支上。
     * (若直接用 TREE,树面自带的 visited=true 是直接证据,按证据优先就不该是未知。) */
    const bare = TREE.map((n) => ({ key: n.key, name: n.name, depth: n.depth }));
    const list = mod.exploreList({ tree: bare, currentChain: CHAIN });
    assert.ok(list.items.length >= 6);
    assert.ok(list.items.every((it) => it.state === 'unknown'), JSON.stringify(list.items.map((x) => x.state)));
    assert.equal(list.readings.unknown, list.items.length);
    assert.equal(list.readings.hasVisitFace, false);
    /* 同一份输入,只要树面自带一条直接证据,它就仍是「去过」——「读不到」不许吞掉直接证据 */
    const withEvidence = mod.exploreList({ tree: TREE, currentChain: CHAIN });
    assert.equal(withEvidence.items.find((x) => x.key === 'city/downtown/cafe').state, 'visited');
    assert.ok(withEvidence.readings.unknown < withEvidence.items.length);
});
test('B2 证据优先:树面自带「去过」不因到访史读不到而作废', () => {
    const list = mod.exploreList({ tree: TREE, currentChain: CHAIN });
    const cafe = list.items.find((x) => x.key === 'city/downtown/cafe');
    assert.equal(cafe.state, 'visited', '树面 visited=true 是直接证据,优先于「没证据」');
    /* 反面:同一份输入下,没有 visited 标记的地方仍是未知(不许一概标去过) */
    assert.equal(list.items.find((x) => x.key === 'city/downtown/library').state, 'unknown');
});
test('B3 四态分组排序稳定:去过 → 可进入 → 待探索 → 未知', () => {
    const list = mod.exploreList(sample());
    const rank = { 'visited': 0, 'enterable': 1, 'to-explore': 2, 'unknown': 3 };
    const seq = list.items.map((x) => rank[x.state]);
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1], '组序被打乱:' + JSON.stringify(list.items.map((x) => x.state)));
    assert.equal(list.items[0].state, 'visited');
    assert.ok(list.readings.visited >= 2 && list.readings.enterable >= 2);
});
test('B4 到访史里树中没有的键 ⇒ 孤儿行照出,不隐藏', () => {
    const list = mod.exploreList(sample({ visits: VISITS.concat([{ key: 'city/market/gone', count: 2 }]) }));
    const orphan = list.items.find((x) => x.orphan === true);
    assert.ok(orphan, '孤儿行必须照出(去过但树里没这处是真缺陷)');
    assert.equal(orphan.key, 'city/market/gone');
    assert.equal(list.readings.orphan, 1);
    assert.equal(orphan.state, 'visited');
});
test('B5 树与到访史都空 ⇒ 如实报「这个会话还没登记过场所」', () => {
    const list = mod.exploreList({ tree: [], currentChain: [] });
    assert.equal(list.reason, 'no-nodes');
    assert.equal(list.state, 'empty');
    assert.equal(list.items.length, 0);
});
test('B6 同祖换路 ⇒ prefix,共同段与步骤都如实', () => {
    const rt = mod.buildRoute(sample(), '三号栈桥');
    assert.equal(rt.ok, true);
    assert.equal(rt.route, 'prefix');
    assert.equal(rt.common, 1, '云城是唯一共同段');
    assert.deepEqual(rt.steps.map((s) => s.segment), ['harbor', 'pier']);
    assert.equal(rt.unknownHeads, 0);
});
test('B7 目标在当前链下方 ⇒ exact', () => {
    const rt = mod.buildRoute(sample(), '临窗角落');
    assert.equal(rt.route, 'exact');
    assert.equal(rt.reason, 'ok');
    assert.deepEqual(rt.steps.map((s) => s.segment), ['corner']);
});
test('B8 目标不在树里 ⇒ 老实说认不出,不就近凑一个节点', () => {
    const rt = mod.buildRoute(sample(), '火星');
    assert.equal(rt.ok, false);
    assert.equal(rt.reason, 'place-unknown');
    assert.equal(rt.route, 'unknown');
    assert.equal(rt.steps.length, 0, '认不出就不许给路线');
});
test('B9 已经在这一处 ⇒ same-place,且不给空跑步骤', () => {
    const rt = mod.buildRoute(sample(), '巷口咖啡');
    assert.equal(rt.ok, true);
    assert.equal(rt.reason, 'same-place');
    assert.equal(rt.steps.length, 0);
});
test('B10 没有当前位置 ⇒ 算不出从哪儿出发(不假装能算)', () => {
    const rt = mod.buildRoute({ tree: TREE, currentChain: [] }, '港口');
    assert.equal(rt.ok, true, '目标认得出,就不该整条失败');
    assert.equal(rt.reason, 'no-current');
    assert.equal(rt.route, 'unknown');
});
test('B11 出口里没有距离 / 耗时格(对象与源码两道查)', () => {
    const rt = mod.buildRoute(sample(), '三号栈桥');
    const p = mod.buildTravelProposal(sample(), '三号栈桥');
    const banned = ['distance', 'eta', 'minutes', 'duration', 'meters', 'km'];
    for (const o of [rt, p, p.place]) {
        for (const b of banned) assert.equal(Object.prototype.hasOwnProperty.call(o, b), false,
            '出口不许有 ' + b);
    }
    /* 第二道用 bareOf(去注释 + 去字符串字面量):禁的是「算距离」的逻辑,
     * 不是连提醒用的字样都不许出现 —— 所以只扫代码本体,不扫字符串里的措辞。 */
    const c = bareOf(core);
    for (const b of banned) assert.equal(c.includes(b), false, '内核代码本体里不得出现 ' + b);
});
test('B12 路账里没有的中段 ⇒ 该步 known=false,并如实计数', () => {
    /* 只把「城门」挂到 downtown 下、不给它父节点之外的桥 —— 用一个树里没有的中间段。 */
    const tree = TREE.concat([{ key: 'city/downtown/gate/inner', name: '内门', depth: 4 }]);
    const rt = mod.buildRoute({ tree, currentChain: CHAIN, visits: [], presence: [], notes: [] }, '内门');
    assert.equal(rt.ok, true);
    const unknown = rt.steps.filter((s) => s.known === false);
    assert.ok(unknown.length >= 1, '树里没有的那一段必须如实标未知');
    assert.equal(rt.unknownHeads, unknown.length);
});
test('B13 在场三态各归各的归因(没这面 / 有面没人 / 有人)', () => {
    const noFace = mod.roamClues(sample({ presence: undefined }), '三号栈桥');
    assert.ok(noFace.lines.some((l) => l.includes(mod.ROAM_REASONS['no-presence-face'])), JSON.stringify(noFace.lines));
    const empty = mod.roamClues(sample({ presence: [] }), '三号栈桥');
    assert.ok(empty.lines.some((l) => l.includes(mod.ROAM_REASONS['no-presence'])), JSON.stringify(empty.lines));
    const some = mod.roamClues(sample(), '三号栈桥');
    assert.ok(some.lines.some((l) => l.includes('阿岚')), JSON.stringify(some.lines));
    assert.equal(some.counts.present >= 1, true);
});
test('B14 往事与约定:读不到 / 没有 / 有三态分开', () => {
    const noFace = mod.roamClues(sample({ notes: undefined }), '三号栈桥');
    assert.ok(noFace.lines.some((l) => l.includes(mod.ROAM_REASONS['no-notes-face'])), JSON.stringify(noFace.lines));
    const empty = mod.roamClues(sample({ notes: [] }), '三号栈桥');
    assert.ok(empty.lines.some((l) => l.includes('还没有记下过')), JSON.stringify(empty.lines));
    const some = mod.roamClues(sample(), '三号栈桥');
    assert.ok(some.lines.some((l) => l.includes('在栈桥碰头')), JSON.stringify(some.lines));
    assert.equal(some.counts.notes, 1);
});
test('B15 提案三行结构:先去哪儿,最后明说「只是提案」', () => {
    const p = mod.buildTravelProposal(sample(), '三号栈桥');
    assert.equal(p.ok, true);
    const lines = p.text.split('\n');
    assert.ok(lines[0].startsWith('打算去「三号栈桥」'), lines[0]);
    assert.ok(lines[lines.length - 1].includes('只是提案'), lines[lines.length - 1]);
    assert.ok(p.text.includes('这是「三号栈桥」'), '线索行必须在(先看再从)');
    assert.ok(typeof p.registerLine === 'string' && p.registerLine.length > 0);
});
test('B16 认不出目标 ⇒ 提案不给半截话(text 一律空串)', () => {
    const p = mod.buildTravelProposal(sample(), '火星');
    assert.equal(p.ok, false);
    assert.equal(p.reason, 'place-unknown');
    assert.equal(p.text, '');
    assert.equal(p.place, null);
});
test('B17 纯函数不改入参', () => {
    const raw = sample();
    const snap = JSON.stringify(raw);
    mod.normalizeRoamInputs(raw);
    mod.buildRoute(raw, '三号栈桥');
    mod.buildTravelProposal(raw, '港口');
    mod.exploreList(raw);
    assert.equal(JSON.stringify(raw), snap, '入参被改了');
});
test('B18 树里同名键只留一条;超上限即截断(不无界)', () => {
    const dup = TREE.concat([{ key: 'city', name: '云城(重复)', depth: 1 }]);
    const inp = mod.normalizeRoamInputs({ tree: dup, currentChain: CHAIN });
    assert.equal(inp.nodes.filter((n) => n.key === 'city').length, 1, '同名键必须去重');
    const many = [];
    for (let i = 0; i < mod.ROAM_LIMITS.nodes + 50; i++) many.push({ key: 'p/' + i, name: 'p' + i, depth: 2 });
    const cut = mod.normalizeRoamInputs({ tree: many, currentChain: [] });
    assert.equal(cut.nodes.length, mod.ROAM_LIMITS.nodes, '必须截到上限');
});

/* ---------- C 接线 ---------- */
test('C1 app 层:往事与约定只读镜像日历账;读不到返回 null(不是空数组)', () => {
    assert.ok(app.includes("storage?.get?.('calendar_commitments'"), '必须读既有约定账(不新开第二个 owner)');
    const i = app.indexOf('notesFace()');
    assert.ok(i > 0);
    const body = app.slice(i, i + 1400);
    assert.ok(body.includes('} catch (_e) { return null; }'), '读不到必须 null');
    assert.equal(/storage\?\.set\?\.\('calendar_commitments'/.test(app), false, '本层不得写约定账');
});
test('C2 app 层:面在不在按「读到没读到」判,不用空数组顶替', () => {
    const i = app.indexOf('roamInputs()');
    const body = app.slice(i, i + 1200);
    assert.ok(body.includes('if (ok && Array.isArray(proj.history)) raw.visits'), '到访史面须按读到才挂');
    assert.ok(body.includes('if (ok && Array.isArray(proj.presence)) raw.presence'), '在场面须按读到才挂');
    assert.ok(body.includes('if (Array.isArray(notes)) raw.notes'), '约定面须按读到才挂');
});
test('C3 app 层:提案交给聊天走既有通道;事件名已登记', () => {
    assert.ok(app.includes("CustomEvent('phone:sendToChat'"), '必须用既有通道');
    assert.ok(events.includes("SEND_TO_CHAT: 'phone:sendToChat'"), '事件须在权威表里');
    const i = app.indexOf('sendProposalToChat(');
    const body = app.slice(i, i + 900);
    assert.ok(body.includes('dispatchEvent'), '必须派发');
    assert.equal(/storage\?\.set/.test(body), false, '交给聊天不许顺带写状态');
});
test('C4 视图层:探索卡排在「同楼同刻」之后、「设置」之前', () => {
    const iCo = view.indexOf('this._coPresenceCard(proj, face),');
    const iRoam = view.indexOf('this._roamCard(proj, face),');
    const iSet = view.indexOf('this._settingsCard(),');
    assert.ok(iCo > 0 && iRoam > iCo && iSet > iRoam, '顺序:同楼同刻 → 探索 → 设置');
});
test('C5 视图层:两处绑定(点选 / 去这儿),去这儿走 app 的提案出口', () => {
    /* 判据只钉「有没有这两处绑定」与「去这儿走不走 app 出口」,不锁取元素的写法:
     * 容器配给本来就是**可缺的**(本层历史契约是只要有 querySelector 就能渲染),
     * 所以必须允许实现走带能力探测的取法 —— 把某个字面量写死在判据里,
     * 等于让判据随时可能被一次正确的加固改红。 */
    assert.ok(/['"]\.pl-roam-pick['"]/.test(view), '点选绑定缺失');
    assert.ok(/['"]\.pl-roam-go['"]/.test(view), '「去这儿」绑定缺失');
    const i = view.indexOf("'.pl-roam-go'");
    const body = view.slice(i, i + 700);
    assert.ok(body.includes('sendProposalToChat'), '去这儿必须走 app 的出口');
    /* 另加一条:取元素这段自身不许在容器缺方法与抛异常时把渲染拖垮(与 A 组「不抛」同域) */
    const j = view.indexOf('.pl-roam-pick');
    const around = view.slice(Math.max(0, j - 900), j);
    assert.ok(/typeof el\.querySelectorAll !== 'function'|try \{/.test(around),
        '取元素须带能力探测或异常兜底(不许裸调把整页连坐)');
});
test('C6 视图层:详情区三态如实(认不出就说认不出)', () => {
    const i = view.indexOf('_showRoamDetail(');
    const body = view.slice(i, i + 1200);
    assert.ok(body.includes("'place-unknown'"), '认不出须单独说');
    assert.ok(body.includes('不猜一个近的顶替'), '认不出须明说「不猜」');
    assert.equal(/storage/.test(codeOf(body)), false, '视图层不得碰存储');
});
test('C7 app 层零地点写:只写设置键,不写任何地点状态', () => {
    assert.ok(app.includes('storage?.set?.(SETTINGS_KEY'), '设置仍然只走这一个写口');
    const c = codeOf(app);
    assert.equal(c.includes('setItem'), false, '不得直接 setItem');
    assert.equal(c.includes('removeItem'), false, '不得直接 removeItem');
    assert.equal(/storage\?\.set\?\.\((?!SETTINGS_KEY)/.test(c), false, '除设置键外不得有第二个写口');
});
test('C8 内核零副作用(去注释后不得出现存储 / 事件 / 定时器)', () => {
    /* 注意:String.prototype.includes 返回布尔 —— 写成 -1 会变成「永真」的哑判据。 */
    const c = bareOf(core);
    for (const bad of ['storage', 'setItem', 'dispatchEvent', 'CustomEvent', 'addEventListener', 'setTimeout']) {
        assert.equal(c.includes(bad), false, '内核里不得出现 ' + bad);
    }
});
test('C9 CSS:四态各有一套选择器,且未知态不是灰', () => {
    for (const cls of ['pl-roam-visited', 'pl-roam-enterable', 'pl-roam-to-explore', 'pl-roam-unknown']) {
        assert.ok(css.includes(cls), '缺态样式:' + cls);
    }
    const i = css.indexOf('.pl-roam-unknown .pl-roam-state');
    assert.ok(i > 0);
    assert.ok(/#b45309/.test(css.slice(i, i + 120)), '未知态须用暖色(与「灰=没啥可看」区分)');
});
test('C10 键登记:设置键仍命中会话隔离前缀,且无新增键', () => {
    assert.ok(data.includes("SETTINGS_KEY") || app.includes("'place_settings_v1'"), '设置键须仍在');
    assert.ok(keys.includes("'place_settings_v1'"), '设置键须已登记');
    assert.ok(read('config/storage.js').includes('/^place_/'), '该键须命中会话隔离前缀');
    assert.equal(/place_roam|roam_settings/.test(keys), false, '本版不得引入新存储键');
});
test('C11 默认设置新增两项,且不写死第二份字段表', () => {
    assert.ok(data.includes('showRoam: true'), '缺 showRoam 默认值');
    assert.ok(data.includes('roamRows: 12'), '缺 roamRows 默认值');
    const i = view.indexOf('_roamCard(');
    assert.ok(i > 0, '视图里须有这张卡');
    /* 不用固定长度切片:卡变长了切片就截不到,判据会静默变假。这里切到下一个方法定义处。 */
    const stop = view.indexOf('    _showRoamDetail(', i + 10);
    const body = view.slice(i, stop > 0 ? stop : view.length);
    assert.ok(body.includes('showRoam !== false'), '视图须尊重开关');
});
test('C12 既有契约不回退:默认设置工厂仍在本 App 的 data 模块', () => {
    assert.ok(/export function defaultPlaceSettings\(\)/.test(data), '工厂不得被搬走');
    assert.ok(data.includes('injectToPrompt: true') && data.includes('maxInject: 8')
        && data.includes('showDiagnostics: true'), '旧三项一个不许少');
});

/* ---------- D 负控制(真源码定点破坏) ---------- */
const brokenFile = (name, src) => {
    const p = path.join(ROOT, 'config', name);
    fs.writeFileSync(p, src, 'utf-8');
    return p;
};
test('D1 破坏「到访史读不到 ⇒ 未知」⇒ 对应判据必转红', async () => {
    const anchor = "    if (o.hasVisitFace !== true) return ROAM_STATES.UNKNOWN;";
    assert.equal(core.split(anchor).length - 1, 1, '锚点须唯一命中');
    const bad = core.replace(anchor, "    if (o.hasVisitFace !== true) return ROAM_STATES.TO_EXPLORE;");
    const p = brokenFile('__broken_v4050_d1.mjs', bad);
    /* 用「不带 visited 标记」的同一棵树:这些地方在原件里本来是未知,破坏后才会塌过去。 */
    const bare = TREE.map((n) => ({ key: n.key, name: n.name, depth: n.depth }));
    try {
        const m = await import(p + '?d1=' + Date.now());
        const list = m.exploreList({ tree: bare, currentChain: CHAIN });
        assert.equal(list.items.some((it) => it.state === 'unknown'), false, '破坏副本:未知应已塌成待探索');
        assert.equal(list.readings.unknown, 0, '破坏副本:未知数为 0(原版此处为全部)');
        assert.ok(list.items.some((it) => it.state === 'to-explore'), '破坏副本里应看得见「待探索」');
        /* 原版同一份输入、同一条判据为真(证明它不是永远真) */
        assert.ok(mod.exploreList({ tree: bare, currentChain: CHAIN }).items.every((it) => it.state === 'unknown'));
    } finally { fs.unlinkSync(p); }
});
test('D2 破坏「孤儿行照出」⇒ 对应判据必转红', async () => {
    const anchor = "        if (seenKey.has(v.key)) continue;";
    assert.equal(core.split(anchor).length - 1, 1, '锚点须唯一命中');
    const bad = core.replace(anchor, "        if (seenKey.has(v.key) || true) continue;");
    const p = brokenFile('__broken_v4050_d2.mjs', bad);
    try {
        const m = await import(p + '?d2=' + Date.now());
        const list = m.exploreList(sample({ visits: VISITS.concat([{ key: 'city/market/gone', count: 2 }]) }));
        assert.equal(list.readings.orphan, 0, '破坏副本:孤儿被藏起来');
        assert.equal(list.items.some((x) => x.orphan === true), false);
        assert.equal(mod.exploreList(sample({ visits: VISITS.concat([{ key: 'city/market/gone', count: 2 }]) })).readings.orphan, 1);
    } finally { fs.unlinkSync(p); }
});
test('D3 破坏「认不出即拒不就近凑」⇒ 对应判据必转红', async () => {
    const anchor = "    if (!node) return { ...base, reason: 'place-unknown' };";
    assert.equal(core.split(anchor).length - 1, 1, '锚点须唯一命中');
    const bad = core.replace(anchor, "    if (!node) return { ...base, ok: true, reason: 'ok', place: { key: want, name: want } };");
    const p = brokenFile('__broken_v4050_d3.mjs', bad);
    try {
        const m = await import(p + '?d3=' + Date.now());
        const rt = m.buildRoute(sample(), '火星');
        assert.equal(rt.ok, true, '破坏副本必须真的把认不出当成认得出');
        assert.notEqual(rt.reason, 'place-unknown');
        assert.equal(mod.buildRoute(sample(), '火星').ok, false);
    } finally { fs.unlinkSync(p); }
});

/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本锚:入口不得低于 4.04.0(下限形,下一版抬版无需二次改写)', () => {
    const v = JSON.parse(read('package.json')).version.split('.').map(Number);
    assert.ok(v[0] > 4 || (v[0] === 4 && v[1] >= 4), '入口版本不得低于 4.04.0,实测 ' + v.join('.'));
});